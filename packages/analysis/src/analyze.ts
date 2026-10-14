import { createHash } from "node:crypto";
import {
  buildExplanation,
  cosineSimilarity,
  type EvidenceItem,
  type ExplanationOutput,
  explanationPrompt,
  indiaToday,
  JobInputError,
  keywordJobExtraction,
  type MatchJob,
  type MatchResult,
  maskContactDetails,
  maskEvidence,
  type Preferences,
  type ProfileContent,
  profileEvidence,
  type StoredRequirement,
  scoreMatch,
  similarityTexts,
  summarizeExperience,
  type VerifiedExplanation,
  verifyExplanation,
  verifyJobExtraction,
} from "@repo/core";
import {
  type Database,
  loadJobEmbedding,
  loadJobForAnalysis,
  loadMatch,
  loadPreferences,
  loadProfile,
  loadProfileEmbedding,
  RateLimitError,
  saveJobAnalysis,
  saveJobEmbedding,
  saveMatch,
  saveProfileEmbedding,
  USER_JOB_PLACEHOLDER,
} from "@repo/db";
import type { Embedder, JobExtractor, MatchExplainer } from "@repo/llm";
import {
  type ExtractionMethod,
  readStoredMatch,
  STORED_MATCH_VERSION,
  type StoredExplanation,
  type StoredScore,
} from "./stored";

export type AnalysisLogger = {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
};
export type AnalysisDeps = {
  /** All three are null when no LLM provider is configured: the keyword reader extracts skills. */
  extractor: JobExtractor | null;
  explainer: MatchExplainer | null;
  embedder: Embedder | null;
  logger?: AnalysisLogger;
  today?: () => string;
};

export type AnalysisMetrics = {
  /** Null when stored requirements were reused. */
  extraction: {
    method: ExtractionMethod;
    cached: boolean;
    attempts: number;
    validityRate: number;
    requirements: number;
    inputTokens: number;
    outputTokens: number;
  } | null;
  explanation: {
    status: "ready" | "fallback";
    /** Quote-validity rate of each model attempt, the metric behind the 90% target. */
    validityRates: number[];
    cached: boolean;
    inputTokens: number;
    outputTokens: number;
    error: "rate_limited" | "provider_error" | null;
  };
  similarity: number | null;
  band: MatchResult["band"];
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");

/** Changes whenever anything matching reads changes, so a match can be flagged as out of date. */
export function matchInputHash(content: ProfileContent, preferences: Preferences | null) {
  return sha256(JSON.stringify({ v: STORED_MATCH_VERSION, content, preferences }));
}

export type MatchContext = {
  profileId: string | null;
  content: ProfileContent;
  preferences: Preferences | null;
  experience: ReturnType<typeof summarizeExperience> | null;
  evidence: EvidenceItem[];
  /** What the explanation model sees, and what its résumé quotes are verified against. */
  maskedEvidence: EvidenceItem[];
  profileHash: string;
};

export async function loadMatchContext(db: Database, userId: string, today: string): Promise<MatchContext> {
  // Sequential on purpose: each call opens its own RLS transaction.
  const { profile, content } = await loadProfile(db, userId);
  const { preferences } = await loadPreferences(db, userId);
  const evidence = profileEvidence(content);
  return {
    profileId: profile?.id ?? null,
    content,
    preferences,
    experience: profile?.status === "confirmed" ? summarizeExperience(content, today) : null,
    evidence,
    maskedEvidence: maskEvidence(evidence),
    profileHash: matchInputHash(content, preferences),
  };
}

type JobRow = NonNullable<Awaited<ReturnType<typeof loadJobForAnalysis>>>["job"];

function matchJob(job: JobRow): MatchJob {
  return {
    roleFamily: job.roleFamily,
    locations: job.locations,
    remoteType: job.remoteType,
    employmentType: job.employmentType,
    salary:
      job.salaryMin === null && job.salaryMax === null
        ? null
        : {
            min: job.salaryMin,
            max: job.salaryMax,
            currency: job.salaryCurrency,
            period: job.salaryPeriod,
          },
  };
}

async function loadOwnedJob(db: Database, userId: string, jobId: string) {
  const loaded = await loadJobForAnalysis(db, jobId);
  if (!loaded || loaded.job.ownerUserId !== userId) {
    throw new JobInputError("This job is no longer available.");
  }
  return loaded;
}

async function similarityFor(
  db: Database,
  deps: AnalysisDeps,
  input: { userId: string; jobId: string; profileId: string | null; profile: string; job: string },
): Promise<number | null> {
  const { embedder } = deps;
  if (!embedder || !input.profileId || !input.profile || !input.job) return null;
  try {
    const jobHash = sha256(input.job);
    const profileHash = sha256(input.profile);
    const profileKey = { profileId: input.profileId, kind: "experience", model: embedder.model };
    let jobVector = await loadJobEmbedding(db, input.jobId, embedder.model, jobHash);
    let profileVector = await loadProfileEmbedding(db, input.userId, {
      ...profileKey,
      contentHash: profileHash,
    });
    const missing = [...(jobVector ? [] : [input.job]), ...(profileVector ? [] : [input.profile])];
    if (missing.length) {
      const vectors = await embedder.embed(missing);
      if (!jobVector) {
        jobVector = vectors.shift() ?? null;
        if (jobVector) {
          await saveJobEmbedding(db, {
            jobId: input.jobId,
            model: embedder.model,
            contentHash: jobHash,
            embedding: jobVector,
          });
        }
      }
      if (!profileVector) {
        profileVector = vectors.shift() ?? null;
        if (profileVector) {
          await saveProfileEmbedding(db, input.userId, {
            ...profileKey,
            contentHash: profileHash,
            embedding: profileVector,
          });
        }
      }
    }
    const similarity = jobVector && profileVector ? cosineSimilarity(jobVector, profileVector) : null;
    return similarity === null ? null : Math.round(similarity * 1000) / 1000;
  } catch (error) {
    // Similarity only refines the band, so a missing embedding never blocks a match.
    deps.logger?.warn({ jobId: input.jobId, err: errorName(error) }, "similarity unavailable");
    return null;
  }
}

async function save(
  db: Database,
  input: {
    userId: string;
    jobId: string;
    match: MatchResult;
    requirements: readonly StoredRequirement[];
    context: MatchContext;
    similarityHash: string;
    extraction: ExtractionMethod;
    verified: VerifiedExplanation | null;
    model: StoredExplanation["model"];
  },
) {
  const explanation = buildExplanation(input.match, input.requirements, input.verified);
  const scoreBreakdown: StoredScore = {
    version: STORED_MATCH_VERSION,
    ...input.match,
    similarityHash: input.similarityHash,
  };
  const stored: StoredExplanation = {
    version: STORED_MATCH_VERSION,
    extraction: input.extraction,
    explanation,
    model: input.model,
  };
  await saveMatch(db, input.userId, input.jobId, {
    band: input.match.band,
    score: input.match.score,
    scoreBreakdown: scoreBreakdown as unknown as Record<string, unknown>,
    explanation: stored as unknown as Record<string, unknown>,
    explanationStatus: input.verified ? "ready" : "fallback",
    profileHash: input.context.profileHash,
  });
  return explanation;
}

const NO_REQUIREMENTS = {
  model:
    "We couldn't find any requirements in this text. Paste the full job description, including the requirements or qualifications section.",
  keywords:
    "We couldn't find any skills we recognise in this text. Paste the full job description, including the skills it asks for.",
} satisfies Record<ExtractionMethod, string>;

/**
 * The full analysis: read the posting's requirements (once), compare them with confirmed evidence,
 * score deterministically, and ask the model to explain. Unverifiable explanations fall back to the
 * structured overlap, so the user always gets strengths, gaps, and checks with real quotes.
 */
export async function analyzeJob(
  db: Database,
  deps: AnalysisDeps,
  input: { userId: string; jobId: string },
): Promise<AnalysisMetrics> {
  const { userId, jobId } = input;
  const today = (deps.today ?? indiaToday)();
  let { job, requirements } = await loadOwnedJob(db, userId, jobId);
  const previous = readStoredMatch(await loadMatch(db, userId, jobId));
  let method: ExtractionMethod = previous?.explanation.extraction ?? (deps.extractor ? "model" : "keywords");
  let extraction: AnalysisMetrics["extraction"] = null;
  // A job read by keywords is read again by the model once a provider is configured.
  if (job.requirementsStatus !== "ready" || (deps.extractor && method === "keywords")) {
    method = deps.extractor ? "model" : "keywords";
    const hints = {
      title: job.title === USER_JOB_PLACEHOLDER.title ? null : job.title,
      company: job.companyName === USER_JOB_PLACEHOLDER.company ? null : job.companyName,
    };
    const result = deps.extractor
      ? await deps.extractor.extract({ userId, text: job.descriptionText, hints })
      : (() => {
          const maskedText = maskContactDetails(job.descriptionText);
          return {
            extraction: verifyJobExtraction(keywordJobExtraction(maskedText), maskedText, hints),
            cached: false,
            attempts: 0,
            inputTokens: 0,
            outputTokens: 0,
          };
        })();
    if (!result.extraction.job.requirements.length) throw new JobInputError(NO_REQUIREMENTS[method]);
    await saveJobAnalysis(db, jobId, result.extraction.job);
    ({ job, requirements } = await loadOwnedJob(db, userId, jobId));
    extraction = {
      method,
      cached: result.cached,
      attempts: result.attempts,
      validityRate: result.extraction.validityRate,
      requirements: requirements.length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }

  const context = await loadMatchContext(db, userId, today);
  const texts = similarityTexts(context.maskedEvidence, requirements);
  const similarity = await similarityFor(db, deps, {
    userId,
    jobId,
    profileId: context.profileId,
    ...texts,
  });
  const match = scoreMatch({
    profile: context.content,
    preferences: context.preferences,
    experience: context.experience,
    job: matchJob(job),
    requirements,
    similarity,
    today,
  });

  const explanation: AnalysisMetrics["explanation"] = {
    status: "fallback",
    validityRates: [],
    cached: false,
    inputTokens: 0,
    outputTokens: 0,
    error: null,
  };
  let verified: VerifiedExplanation | null = null;
  let model: StoredExplanation["model"] = null;
  if (deps.explainer) {
    const description = maskContactDetails(job.descriptionText);
    const verify = (output: ExplanationOutput) =>
      verifyExplanation(output, { requirements, evidence: context.maskedEvidence, description });
    try {
      const result = await deps.explainer.explain({
        userId,
        prompt: explanationPrompt({
          job: { title: job.title, company: job.companyName },
          requirements,
          match,
          evidence: context.maskedEvidence,
        }),
        verify,
      });
      Object.assign(explanation, {
        validityRates: result.validityRates,
        cached: result.cached,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      if (result.output && result.verified) {
        verified = result.verified;
        explanation.status = "ready";
        model = {
          output: result.output,
          requirementIds: requirements.map((requirement) => requirement.id),
          evidenceHash: sha256(JSON.stringify(context.maskedEvidence)),
        };
      }
    } catch (error) {
      explanation.error = error instanceof RateLimitError ? "rate_limited" : "provider_error";
      deps.logger?.warn(
        { jobId, err: errorName(error) },
        "explanation unavailable, using structured overlap",
      );
    }
  }

  await save(db, {
    userId,
    jobId,
    match,
    requirements,
    context,
    similarityHash: sha256(JSON.stringify([texts.profile, texts.job])),
    extraction: method,
    verified,
    model,
  });
  const metrics: AnalysisMetrics = { extraction, explanation, similarity, band: match.band };
  deps.logger?.info({ jobId, ...metrics }, "job analysis finished");
  return metrics;
}

/**
 * Re-scores after a profile change (such as a gap answer) without calling any model: similarity is
 * reused while the compared texts are unchanged, and the stored model output is re-verified against
 * the new evidence. Returns null when there is no ready analysis to refresh.
 */
export async function refreshMatch(db: Database, input: { userId: string; jobId: string; today?: string }) {
  const { userId, jobId } = input;
  const today = input.today ?? indiaToday();
  const { job, requirements } = await loadOwnedJob(db, userId, jobId);
  const previous = readStoredMatch(await loadMatch(db, userId, jobId));
  if (job.requirementsStatus !== "ready" || !previous) return null;
  const context = await loadMatchContext(db, userId, today);
  const texts = similarityTexts(context.maskedEvidence, requirements);
  const similarityHash = sha256(JSON.stringify([texts.profile, texts.job]));
  const match = scoreMatch({
    profile: context.content,
    preferences: context.preferences,
    experience: context.experience,
    job: matchJob(job),
    requirements,
    similarity: previous.score.similarityHash === similarityHash ? previous.score.similarity : null,
    today,
  });
  const stored = previous.explanation.model;
  const sameRequirements =
    stored !== null &&
    stored.requirementIds.length === requirements.length &&
    stored.requirementIds.every((id, index) => requirements[index]?.id === id);
  let verified: VerifiedExplanation | null = null;
  if (stored && sameRequirements) {
    verified = verifyExplanation(stored.output, {
      requirements,
      evidence: context.maskedEvidence,
      description: maskContactDetails(job.descriptionText),
    });
    // The summary was written about the old evidence and can't be checked quote by quote.
    if (stored.evidenceHash !== sha256(JSON.stringify(context.maskedEvidence))) {
      verified = { ...verified, summary: null };
    }
  }
  return save(db, {
    userId,
    jobId,
    match,
    requirements,
    context,
    similarityHash,
    extraction: previous.explanation.extraction,
    verified,
    model: sameRequirements ? stored : null,
  });
}

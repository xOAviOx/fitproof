import {
  cleanJobText,
  EMBEDDING_DIMENSIONS,
  EXPLANATION_SYSTEM,
  type ExplanationOutput,
  emptyProfile,
  type JobExtraction,
  type ProfileContent,
} from "@repo/core";
import {
  createUserJob,
  type Database,
  loadJobForAnalysis,
  loadMatch,
  loadUserJob,
  recordGapResponse,
  saveProfile,
  schema,
} from "@repo/db";
import { createAuthUser, createTestDb, type TestDb } from "@repo/db/testing";
import {
  createEmbedder,
  createJobExtractor,
  createMatchExplainer,
  llmEnvSchema,
  type ObjectGenerator,
  type ObjectRequest,
} from "@repo/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type AnalysisDeps,
  createAnalysisDeps,
  processAnalysisRunById,
  readStoredMatch,
  refreshMatch,
  runQueuedAnalyses,
} from "./index";

let test: TestDb;
beforeAll(async () => {
  test = await createTestDb();
}, 30_000);
afterAll(async () => {
  await test.close();
});

const env = llmEnvSchema.parse({ GEMINI_API_KEY: "synthetic-test-key", LLM_RPM: 100 });
const TODAY = "2026-10-14";

const POSTING = cleanJobText(`Backend Engineer (Payments)
Acme Pay, Bengaluru

Requirements
- Strong Node.js and TypeScript skills.
- Experience with PostgreSQL.
- Kafka is a plus.
- Open to 2025 and 2026 graduates only.

What you'll do
- Build and run payment APIs for merchants across India.
- Write tests and review code with the team.
Questions? Write to hiring@acmepay.example.`);

const PROFILE: ProfileContent = {
  ...emptyProfile(),
  experiences: [
    {
      sourceText: null,
      userConfirmed: true,
      tier: "internship",
      company: "Ledgerly",
      title: "Backend Intern",
      location: "Pune",
      startDate: "2025-01-01",
      endDate: "2025-06-30",
      isCurrent: false,
      bullets: ["Built payment APIs in Node.js and TypeScript for 40 merchants"],
      skills: ["Node.js", "TypeScript"],
    },
  ],
  projects: [
    {
      sourceText: null,
      userConfirmed: true,
      name: "Splitwise clone",
      description: "Expense sharing app on PostgreSQL",
      url: null,
      bullets: [],
      skills: ["PostgreSQL"],
    },
  ],
  education: [
    {
      sourceText: null,
      userConfirmed: true,
      institution: "COEP",
      degree: "B.Tech",
      branch: "Computer Engineering",
      startYear: 2022,
      graduationYear: 2026,
      scoreType: null,
      score: null,
      scoreScale: null,
      coursework: [],
    },
  ],
};

async function userWithProfile() {
  const userId = await createAuthUser(test.db);
  await saveProfile(test.db, userId, { content: PROFILE, revision: null, confirm: true });
  return userId;
}

async function addJob(userId: string, description = POSTING) {
  const created = await createUserJob(test.db, userId, {
    source: "user_paste",
    description,
    sourceUrl: null,
    title: null,
    company: null,
  });
  if (!created.runId) throw new Error("expected a queued run");
  return { jobId: created.jobId, runId: created.runId };
}

const EXTRACTION: JobExtraction = {
  title: "Backend Engineer (Payments)",
  company: "Acme Pay",
  locations: ["Bengaluru"],
  remoteType: "onsite",
  employmentType: "full_time",
  seniority: "entry",
  roleFamily: "backend",
  salary: null,
  requirements: [
    {
      type: "core_skill",
      text: "Node.js",
      quote: "Strong Node.js and TypeScript skills.",
      skill: "Node.js",
      eligibility: null,
    },
    {
      type: "core_skill",
      text: "TypeScript",
      quote: "Strong Node.js and TypeScript skills.",
      skill: "TypeScript",
      eligibility: null,
    },
    {
      type: "core_skill",
      text: "PostgreSQL",
      quote: "Experience with PostgreSQL.",
      skill: "PostgreSQL",
      eligibility: null,
    },
    { type: "nice_to_have", text: "Kafka", quote: "Kafka is a plus.", skill: "Kafka", eligibility: null },
    {
      type: "hard_eligibility",
      text: "2025 or 2026 graduates",
      quote: "Open to 2025 and 2026 graduates only.",
      skill: null,
      eligibility: {
        kind: "graduation_batch",
        cities: null,
        relocationAccepted: null,
        country: null,
        sponsorshipAvailable: null,
        degreeLevels: null,
        degrees: null,
        fields: null,
        allowRelated: null,
        minScores: null,
        graduationYears: [2025, 2026],
        minYears: null,
        maxYears: null,
        joinWithinDays: null,
        startBy: null,
      },
    },
    {
      type: "responsibility",
      text: "Build payment APIs",
      quote: "Build and run payment APIs for merchants across India.",
      skill: null,
      eligibility: null,
    },
  ],
};

const EXPLANATION: ExplanationOutput = {
  summary: "Your internship built the same kind of payment APIs.",
  strengths: [
    {
      requirement: "R1",
      resumeQuote: "Built payment APIs in Node.js and TypeScript for 40 merchants",
      note: "Node.js in production.",
    },
    {
      requirement: "R6",
      resumeQuote: "Built payment APIs in Node.js and TypeScript for 40 merchants",
      note: "Same work.",
    },
  ],
  gaps: [{ requirement: "R4", jobQuote: "Kafka is a plus.", note: "Build a small Kafka consumer." }],
  checks: [],
};

const reply = (object: unknown) => ({ object, inputTokens: 10, outputTokens: 20 });
function fakeGenerator(explanations: ExplanationOutput[] = [EXPLANATION]) {
  let call = 0;
  return vi.fn<ObjectGenerator>(async (request: ObjectRequest) => {
    if (request.system !== EXPLANATION_SYSTEM) return reply(EXTRACTION);
    const output = explanations[Math.min(call, explanations.length - 1)];
    call++;
    return reply(output);
  });
}
const vector = (seed: number) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(i * seed + 1));

function modelDeps(
  generate: ObjectGenerator,
  embed = vi.fn(async (values: string[]) => values.map(() => vector(1))),
) {
  return {
    extractor: createJobExtractor(test.db, env, generate),
    explainer: createMatchExplainer(test.db, env, generate),
    embedder: createEmbedder(test.db, env, embed),
    today: () => TODAY,
  } satisfies AnalysisDeps;
}

async function storedMatch(db: Database, userId: string, jobId: string) {
  const row = await loadMatch(db, userId, jobId);
  const stored = readStoredMatch(row);
  if (!row || !stored) throw new Error("expected a stored match");
  return { row, ...stored };
}

describe("analysis with a model", () => {
  it("extracts, scores, explains with verified quotes, and caches embeddings", async () => {
    const userId = await userWithProfile();
    const { jobId, runId } = await addJob(userId);
    const generate = fakeGenerator();
    const embed = vi.fn(async (values: string[]) => values.map(() => vector(1)));
    const outcome = await processAnalysisRunById(test.db, modelDeps(generate, embed), runId);
    expect(outcome).toMatchObject({ ok: true });

    const extractionPrompt = generate.mock.calls[0]?.[0].prompt ?? "";
    expect(extractionPrompt).not.toContain("hiring@acmepay.example");
    const explanationPrompt = generate.mock.calls[1]?.[0].prompt ?? "";
    expect(explanationPrompt).toContain("R4 | Nice to have | Kafka | missing");
    expect(explanationPrompt).toContain("R5 | Eligibility");

    const { row, explanation, score } = await storedMatch(test.db, userId, jobId);
    expect(row.explanationStatus).toBe("ready");
    expect(row.band).toBe("strong");
    expect(score.similarity).toBe(1);
    expect(explanation.extraction).toBe("model");
    expect(explanation.explanation.summary).toBe(EXPLANATION.summary);
    expect(explanation.explanation.quoteValidityRate).toBe(1);
    expect(explanation.explanation.strengths.map((item) => item.requirement)).toEqual([
      "Node.js",
      "Build payment APIs",
      "TypeScript",
      "PostgreSQL",
    ]);
    expect(explanation.explanation.gaps).toMatchObject([
      { skill: "kafka", core: false, jobQuote: "Kafka is a plus.", note: "Build a small Kafka consumer." },
    ]);
    // No saved preferences means the graduation year is unknown: a check, never an exclusion.
    expect(score.requirementChecks.map((item) => item.check.status)).toEqual(["check"]);
    expect(explanation.explanation.checks).toMatchObject([
      { jobQuote: "Open to 2025 and 2026 graduates only." },
    ]);

    const job = await loadUserJob(test.db, userId, jobId);
    expect(job?.job).toMatchObject({ title: "Backend Engineer (Payments)", companyName: "Acme Pay" });
    expect(job?.run?.status).toBe("succeeded");

    // Re-checking reuses stored requirements and both embeddings.
    await processAnalysisRunById(test.db, modelDeps(generate, embed), (await addRerun(userId, jobId)).id);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls.filter((call) => call[0].system !== EXPLANATION_SYSTEM)).toHaveLength(1);
  });

  it("keeps contact details in profile entries away from the embedding model", async () => {
    const userId = await createAuthUser(test.db);
    const [internship] = PROFILE.experiences;
    if (!internship) throw new Error("expected an experience");
    const bullet =
      "On call via ops@ledgerly.example or +91 98765 43210; runbook at https://ledgerly.example/runbook";
    await saveProfile(test.db, userId, {
      content: { ...PROFILE, experiences: [{ ...internship, bullets: [...internship.bullets, bullet] }] },
      revision: null,
      confirm: true,
    });
    const { runId } = await addJob(userId);
    const embed = vi.fn(async (values: string[]) => values.map(() => vector(1)));
    await processAnalysisRunById(test.db, modelDeps(fakeGenerator(), embed), runId);

    const sent = embed.mock.calls.flatMap(([values]) => values).join("\n");
    expect(sent).toContain("Built payment APIs in Node.js");
    expect(sent).toContain("[email removed]");
    for (const secret of ["ops@ledgerly.example", "98765", "ledgerly.example/runbook"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("falls back to the structured overlap when both explanation attempts fail verification", async () => {
    const userId = await userWithProfile();
    const { jobId, runId } = await addJob(userId);
    const invented: ExplanationOutput = {
      ...EXPLANATION,
      strengths: [{ requirement: "R1", resumeQuote: "Led the Node.js platform team", note: "x" }],
      gaps: [{ requirement: "R4", jobQuote: "Kafka is required.", note: "x" }],
    };
    const generate = fakeGenerator([invented]);
    const outcome = await processAnalysisRunById(test.db, modelDeps(generate), runId);
    expect(outcome).toMatchObject({
      ok: true,
      metrics: { explanation: { status: "fallback", validityRates: [0, 0] } },
    });
    expect(generate).toHaveBeenCalledTimes(3);
    const { row, explanation } = await storedMatch(test.db, userId, jobId);
    expect(row.explanationStatus).toBe("fallback");
    expect(explanation.explanation.source).toBe("structured");
    expect(explanation.explanation.summary).toBeNull();
    expect(explanation.explanation.strengths[0]).toMatchObject({
      requirement: "Node.js",
      resumeQuote: "Built payment APIs in Node.js and TypeScript for 40 merchants",
      tier: "internship",
    });
    expect(explanation.explanation.gaps.map((gap) => gap.skill)).toEqual(["kafka"]);
  });

  it("keeps the match when the explanation provider fails", async () => {
    const userId = await userWithProfile();
    const { jobId, runId } = await addJob(userId);
    const generate = vi.fn<ObjectGenerator>(async (request) => {
      if (request.system === EXPLANATION_SYSTEM) throw new Error("provider down");
      return reply(EXTRACTION);
    });
    const outcome = await processAnalysisRunById(test.db, modelDeps(generate), runId);
    expect(outcome).toMatchObject({ ok: true, metrics: { explanation: { error: "provider_error" } } });
    expect((await storedMatch(test.db, userId, jobId)).row.explanationStatus).toBe("fallback");
  });

  it("re-scores a gap answer without calling the model and re-verifies stored quotes", async () => {
    const userId = await userWithProfile();
    const { jobId, runId } = await addJob(userId);
    await processAnalysisRunById(test.db, modelDeps(fakeGenerator()), runId);
    const before = await storedMatch(test.db, userId, jobId);
    const kafka = before.explanation.explanation.gaps[0];
    if (!kafka) throw new Error("expected a Kafka gap");

    const { profileChanged } = await recordGapResponse(test.db, userId, {
      jobId,
      requirementId: kafka.requirementId,
      response: "has_it",
    });
    expect(profileChanged).toBe(true);
    const explanation = await refreshMatch(test.db, { userId, jobId, today: TODAY });
    expect(explanation?.gaps).toEqual([]);
    expect(explanation?.strengths.find((item) => item.requirement === "Kafka")).toMatchObject({
      resumeQuote: "Kafka",
      tier: "self_declared",
    });
    expect(explanation?.summary).toBeNull();
    expect(explanation?.strengths[0]?.note).toBe("Node.js in production.");
    const after = await storedMatch(test.db, userId, jobId);
    expect(after.row.profileHash).not.toBe(before.row.profileHash);
    expect(after.score.similarity).toBe(before.score.similarity);
  });
});

describe("analysis without a model", () => {
  it("reads known skills by keyword and explains with structured quotes only", async () => {
    const userId = await userWithProfile();
    const { jobId, runId } = await addJob(userId);
    const deps = createAnalysisDeps(test.db, null);
    expect(deps.mode).toBe("keywords");
    const outcome = await processAnalysisRunById(test.db, { ...deps, today: () => TODAY }, runId);
    expect(outcome).toMatchObject({
      ok: true,
      metrics: { extraction: { method: "keywords", validityRate: 1 } },
    });
    const loaded = await loadJobForAnalysis(test.db, jobId);
    expect(loaded?.requirements.map((item) => [item.type, item.skill]).sort()).toEqual([
      ["core_skill", "nodejs"],
      ["core_skill", "postgresql"],
      ["core_skill", "typescript"],
      ["nice_to_have", "kafka"],
    ]);
    const { row, explanation } = await storedMatch(test.db, userId, jobId);
    expect(row.explanationStatus).toBe("fallback");
    expect(explanation.extraction).toBe("keywords");
    expect(explanation.explanation.gaps.map((gap) => gap.skill)).toEqual(["kafka"]);
  });

  it("fails permanently, with a message, when the text has nothing to match", async () => {
    const userId = await userWithProfile();
    const { jobId, runId } = await addJob(
      userId,
      cleanJobText(`About us\n${"We are a friendly team that loves our customers. ".repeat(6)}`),
    );
    const outcome = await processAnalysisRunById(test.db, { ...createAnalysisDeps(test.db, null) }, runId);
    expect(outcome).toMatchObject({ ok: false, retrying: false });
    const job = await loadUserJob(test.db, userId, jobId);
    expect(job?.job.requirementsStatus).toBe("failed");
    expect(job?.run).toMatchObject({
      status: "failed",
      error: expect.stringContaining("skills we recognise"),
    });
  });
});

describe("queue handling", () => {
  it("retries transient extraction failures, then marks the job failed", async () => {
    const userId = await userWithProfile();
    const { jobId, runId } = await addJob(userId);
    const failing = vi.fn<ObjectGenerator>(async () => {
      throw new Error("provider down");
    });
    const first = await processAnalysisRunById(test.db, modelDeps(failing), runId);
    expect(first).toMatchObject({ ok: false, retrying: true });
    expect((await loadUserJob(test.db, userId, jobId))?.job.requirementsStatus).toBe("pending");
    // Make the retry due now, and exhaust the remaining attempts through the worker loop.
    for (let attempt = 0; attempt < 2; attempt++) {
      await test.db
        .update(schema.jobRuns)
        .set({ scheduledAt: new Date(0) })
        .where(eq(schema.jobRuns.id, runId));
      await runQueuedAnalyses(test.db, modelDeps(failing), { maxJobs: 1 });
    }
    const job = await loadUserJob(test.db, userId, jobId);
    expect(job?.job.requirementsStatus).toBe("failed");
    expect(job?.run).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("never analyses a job for someone who doesn't own it", async () => {
    const owner = await userWithProfile();
    const intruder = await userWithProfile();
    const { jobId } = await addJob(owner);
    const [run] = await test.db
      .insert(schema.jobRuns)
      .values({ kind: "job.analyze", userId: intruder, payload: { jobId } })
      .returning();
    if (!run) throw new Error("insert failed");
    const outcome = await processAnalysisRunById(test.db, createAnalysisDeps(test.db, null), run.id);
    expect(outcome).toMatchObject({ ok: false, retrying: false });
    expect(await loadMatch(test.db, intruder, jobId)).toBeNull();
  });
});

async function addRerun(userId: string, jobId: string) {
  const [run] = await test.db
    .insert(schema.jobRuns)
    .values({ kind: "job.analyze", userId, payload: { jobId } })
    .returning();
  if (!run) throw new Error("insert failed");
  return run;
}

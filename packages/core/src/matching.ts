import { z } from "zod";
import { SCORING_CONFIG } from "./config/scoring";
import {
  type EligibilityResult,
  evaluateJobEligibility,
  type FitCheck,
  type HardRequirement,
  type JobFacts,
} from "./eligibility";
import { type ExtractedRequirement, requirementLabel } from "./jobs";
import type { ExperienceSummary, Preferences } from "./preferences";
import { type ProfileContent, quoteExists } from "./profile";
import { mentionsSkill, skillKey } from "./skills";
import type { EvidenceTier, GapResponse, MatchBand } from "./vocab";

export type StoredRequirement = ExtractedRequirement & { id: string };

/** One confirmed profile entry, as matching and the explanation prompt see it. No contact details. */
export type EvidenceItem = {
  ref: string;
  kind: "experience" | "project" | "education" | "certification" | "skill";
  tier: EvidenceTier;
  heading: string;
  texts: string[];
  /** Skill names listed on the entry. Used as evidence only when no text mentions the skill. */
  skills: string[];
};

const present = (values: (string | null | undefined)[]) =>
  values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0);

export function profileEvidence(content: ProfileContent): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const add = (item: Omit<EvidenceItem, "ref">) => items.push({ ...item, ref: `E${items.length + 1}` });
  for (const row of content.experiences.filter((entry) => entry.userConfirmed)) {
    add({
      kind: "experience",
      tier: row.tier,
      heading: `${row.title} at ${row.company}`,
      texts: present([row.sourceText, ...row.bullets]),
      skills: present(row.skills),
    });
  }
  for (const row of content.projects.filter((entry) => entry.userConfirmed)) {
    add({
      kind: "project",
      tier: "project",
      heading: row.name,
      texts: present([row.sourceText, row.description, ...row.bullets]),
      skills: present(row.skills),
    });
  }
  for (const row of content.education.filter((entry) => entry.userConfirmed)) {
    add({
      kind: "education",
      tier: "coursework_or_certification",
      heading: present([row.degree, row.branch, row.institution]).join(", "),
      texts: present([row.sourceText, ...row.coursework]),
      skills: [],
    });
  }
  for (const row of content.certifications.filter((entry) => entry.userConfirmed)) {
    add({
      kind: "certification",
      tier: "coursework_or_certification",
      heading: present([row.name, row.issuer]).join(", "),
      texts: present([row.sourceText, row.name]),
      skills: present(row.skills),
    });
  }
  for (const row of content.skills.filter((entry) => entry.userConfirmed)) {
    add({
      kind: "skill",
      tier: row.tier,
      heading: row.name,
      texts: present([row.sourceText]),
      skills: [row.name],
    });
  }
  return items;
}

export type SkillEvidence = { tier: EvidenceTier; weight: number; quote: string; ref: string };

/** The strongest confirmed evidence for one skill key, or null. */
export function findSkillEvidence(evidence: readonly EvidenceItem[], key: string): SkillEvidence | null {
  let best: SkillEvidence | null = null;
  for (const item of evidence) {
    const listed = item.skills.find((name) => skillKey(name) === key) ?? null;
    const quote =
      item.kind === "skill"
        ? listed
        : // The shortest mentioning text is the most specific quote (a bullet over the whole entry).
          ([...item.texts].sort((a, b) => a.length - b.length).find((text) => mentionsSkill(text, key)) ??
          listed);
    if (!quote) continue;
    const weight = SCORING_CONFIG.evidenceWeights[item.tier];
    if (!best || weight > best.weight) best = { tier: item.tier, weight, quote, ref: item.ref };
  }
  return best;
}

export type SkillAssessment = {
  requirementId: string;
  type: "core_skill" | "nice_to_have";
  skill: string;
  label: string;
  quote: string;
  evidence: SkillEvidence | null;
};
export type RequirementCheck = { requirementId: string; check: FitCheck };
export type MatchJob = Omit<JobFacts, "requirements">;
export type MatchInput = {
  profile: ProfileContent;
  preferences: Preferences | null;
  experience: ExperienceSummary | null;
  job: MatchJob;
  requirements: readonly StoredRequirement[];
  /** Cosine similarity of profile experience and job responsibilities, or null when unavailable. */
  similarity: number | null;
  today: string;
};
export type MatchResult = {
  band: MatchBand;
  score: number;
  coreCoverage: number | null;
  similarity: number | null;
  skills: SkillAssessment[];
  preferenceChecks: FitCheck[];
  requirementChecks: RequirementCheck[];
  unclear: { requirementId: string; text: string; quote: string }[];
};

const STATUS_VALUE = { met: 1, check: 0.5, unmet: 0 } as const;

/**
 * Deterministic, explainable scoring (ADR-023). Excluded only on a known-failed hard requirement.
 * Preference mismatches lower ordering but never hide a job the user chose to paste.
 */
export function scoreMatch(input: MatchInput): MatchResult {
  const evidence = profileEvidence(input.profile);
  const skills: SkillAssessment[] = [];
  const hard: { id: string; requirement: HardRequirement }[] = [];
  const unclear: MatchResult["unclear"] = [];
  for (const requirement of input.requirements) {
    if ((requirement.type === "core_skill" || requirement.type === "nice_to_have") && requirement.skill) {
      skills.push({
        requirementId: requirement.id,
        type: requirement.type,
        skill: requirement.skill,
        label: requirementLabel(requirement),
        quote: requirement.quote,
        evidence: findSkillEvidence(evidence, requirement.skill),
      });
    } else if (requirement.type === "hard_eligibility" && requirement.eligibility) {
      hard.push({ id: requirement.id, requirement: requirement.eligibility });
    } else if (requirement.type === "unclear" || requirement.type === "hard_eligibility") {
      unclear.push({ requirementId: requirement.id, text: requirement.text, quote: requirement.quote });
    }
  }
  const eligibility: EligibilityResult = evaluateJobEligibility(
    { preferences: input.preferences, experience: input.experience },
    { ...input.job, requirements: hard.map((item) => item.requirement) },
    input.today,
  );
  const preferenceChecks = eligibility.checks.filter((check) => check.source === "preference");
  // evaluateJobEligibility appends one requirement check per requirement, in order.
  const requirementChecks = eligibility.checks
    .filter((check) => check.source === "requirement")
    .map((check, index) => ({ requirementId: hard[index]?.id ?? "", check }));

  const coverageOf = (type: SkillAssessment["type"]) => {
    const group = skills.filter((skill) => skill.type === type);
    if (!group.length) return null;
    return group.reduce((sum, skill) => sum + (skill.evidence?.weight ?? 0), 0) / group.length;
  };
  const coreCoverage = coverageOf("core_skill") ?? coverageOf("nice_to_have");
  const { bands, ordering } = SCORING_CONFIG;
  const similar = input.similarity !== null && input.similarity >= bands.strong.minResponsibilitySimilarity;
  const band: MatchBand = requirementChecks.some((item) => item.check.status === "unmet")
    ? "excluded"
    : coreCoverage === null
      ? similar
        ? "good"
        : "partial"
      : coreCoverage >= bands.strong.minCoreCoverage && similar
        ? "strong"
        : coreCoverage >= bands.good.minCoreCoverage
          ? "good"
          : coreCoverage >= bands.partial.minCoreCoverage
            ? "partial"
            : "low";
  const preferenceFit = preferenceChecks.length
    ? preferenceChecks.reduce((sum, check) => sum + STATUS_VALUE[check.status], 0) / preferenceChecks.length
    : 1;
  const score =
    ordering.coverage * (coreCoverage ?? ordering.neutralCoverage) +
    ordering.similarity * Math.max(0, input.similarity ?? 0) +
    ordering.preferences * preferenceFit;
  return {
    band,
    score: Math.round(score * 1000) / 1000,
    coreCoverage: coreCoverage === null ? null : Math.round(coreCoverage * 1000) / 1000,
    similarity: input.similarity,
    skills,
    preferenceChecks,
    requirementChecks,
    unclear,
  };
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? null : dot / Math.sqrt(normA * normB);
}

/** Text compared for responsibility similarity. Empty strings mean "not enough to compare". */
export function similarityTexts(
  evidence: readonly EvidenceItem[],
  requirements: readonly StoredRequirement[],
) {
  return {
    profile: evidence
      .filter((item) => item.kind === "experience" || item.kind === "project")
      .flatMap((item) => [item.heading, ...item.texts])
      .join("\n")
      .slice(0, 8000),
    job: requirements
      .filter((item) => item.type === "responsibility" || item.type === "core_skill")
      .map((item) => item.quote)
      .join("\n")
      .slice(0, 8000),
  };
}

const note = z.string().max(600);
/** What the explanation model returns. `requirement` is a short reference such as "R3". */
export const explanationOutputSchema = z.object({
  summary: note,
  strengths: z
    .array(z.object({ requirement: z.string().max(10), resumeQuote: z.string().max(1000), note }))
    .max(30),
  gaps: z.array(z.object({ requirement: z.string().max(10), jobQuote: z.string().max(1000), note })).max(30),
  checks: z
    .array(z.object({ requirement: z.string().max(10), jobQuote: z.string().max(1000), note }))
    .max(30),
});
export type ExplanationOutput = z.infer<typeof explanationOutputSchema>;

export const requirementRef = (index: number) => `R${index + 1}`;

/** Drops every item whose quote isn't verbatim in its source (after whitespace and case normalization). */
export function verifyExplanation(
  raw: ExplanationOutput,
  context: {
    requirements: readonly StoredRequirement[];
    evidence: readonly EvidenceItem[];
    description: string;
  },
) {
  const byRef = new Map(
    context.requirements.map((requirement, index) => [requirementRef(index), requirement]),
  );
  const evidenceTexts = context.evidence.flatMap((item) => [item.heading, ...item.texts, ...item.skills]);
  let total = 0;
  let valid = 0;
  const strengths: { requirementId: string; resumeQuote: string; note: string }[] = [];
  for (const item of raw.strengths) {
    total++;
    const requirement = byRef.get(item.requirement.trim());
    if (!requirement || !evidenceTexts.some((text) => quoteExists(text, item.resumeQuote))) continue;
    valid++;
    if (requirement.type !== "hard_eligibility" && requirement.type !== "unclear") {
      strengths.push({
        requirementId: requirement.id,
        resumeQuote: item.resumeQuote.trim(),
        note: item.note.trim(),
      });
    }
  }
  const notes = (items: ExplanationOutput["gaps"]) => {
    const result = new Map<string, string>();
    for (const item of items) {
      total++;
      const requirement = byRef.get(item.requirement.trim());
      if (!requirement || !quoteExists(context.description, item.jobQuote)) continue;
      valid++;
      if (item.note.trim()) result.set(requirement.id, item.note.trim());
    }
    return result;
  };
  const gapNotes = notes(raw.gaps);
  const checkNotes = notes(raw.checks);
  return {
    summary: raw.summary.trim() || null,
    strengths,
    gapNotes,
    checkNotes,
    total,
    valid,
    validityRate: total === 0 ? 1 : valid / total,
  };
}
export type VerifiedExplanation = ReturnType<typeof verifyExplanation>;

export type Explanation = {
  /** `structured` means verification failed twice (or no model was available), so there is no prose. */
  source: "model" | "structured";
  summary: string | null;
  strengths: {
    requirementId: string;
    requirement: string;
    resumeQuote: string;
    tier: EvidenceTier | null;
    note: string | null;
  }[];
  gaps: {
    requirementId: string;
    requirement: string;
    skill: string;
    jobQuote: string;
    core: boolean;
    note: string | null;
    response: GapResponse | null;
  }[];
  checks: { requirementId: string; requirement: string; jobQuote: string; note: string | null }[];
  quoteValidityRate: number | null;
};

/**
 * Evidence-linked explanation. Deterministic skill overlap is the backbone, so every gap gets a
 * prompt even when the model is unavailable; verified model output adds prose and responsibility matches.
 */
export function buildExplanation(
  match: MatchResult,
  requirements: readonly StoredRequirement[],
  model: VerifiedExplanation | null,
  responses: ReadonlyMap<string, GapResponse> = new Map(),
): Explanation {
  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const label = (id: string) => {
    const requirement = byId.get(id);
    return requirement ? requirementLabel(requirement) : "";
  };
  const strengths: Explanation["strengths"] = [];
  const covered = new Set<string>();
  for (const item of model?.strengths ?? []) {
    if (covered.has(item.requirementId)) continue;
    covered.add(item.requirementId);
    const skill = match.skills.find((assessment) => assessment.requirementId === item.requirementId);
    if (skill && !skill.evidence) continue;
    strengths.push({
      requirementId: item.requirementId,
      requirement: label(item.requirementId),
      resumeQuote: item.resumeQuote,
      tier: skill?.evidence?.tier ?? null,
      note: item.note || null,
    });
  }
  for (const skill of match.skills) {
    if (!skill.evidence || covered.has(skill.requirementId)) continue;
    covered.add(skill.requirementId);
    strengths.push({
      requirementId: skill.requirementId,
      requirement: skill.label,
      resumeQuote: skill.evidence.quote,
      tier: skill.evidence.tier,
      note: null,
    });
  }
  const gaps: Explanation["gaps"] = match.skills
    .filter((skill) => !skill.evidence)
    .sort((a, b) => Number(b.type === "core_skill") - Number(a.type === "core_skill"))
    .map((skill) => ({
      requirementId: skill.requirementId,
      requirement: skill.label,
      skill: skill.skill,
      jobQuote: skill.quote,
      core: skill.type === "core_skill",
      note: model?.gapNotes.get(skill.requirementId) ?? null,
      response: responses.get(skill.requirementId) ?? null,
    }));
  const checks: Explanation["checks"] = [
    ...match.requirementChecks
      .filter((item) => item.check.status === "check" && item.check.source === "requirement")
      .map((item) => ({
        requirementId: item.requirementId,
        requirement: item.check.message,
        jobQuote: item.check.source === "requirement" ? item.check.quote : "",
        note: model?.checkNotes.get(item.requirementId) ?? null,
      })),
    ...match.unclear.map((item) => ({
      requirementId: item.requirementId,
      requirement: item.text,
      jobQuote: item.quote,
      note: model?.checkNotes.get(item.requirementId) ?? null,
    })),
  ];
  return {
    source: model ? "model" : "structured",
    summary: model?.summary ?? null,
    strengths,
    gaps,
    checks,
    quoteValidityRate: model ? model.validityRate : null,
  };
}

export const MATCH_BAND_LABELS: Record<MatchBand, string> = {
  strong: "Strong",
  good: "Good",
  partial: "Partial",
  low: "Low",
  excluded: "Not eligible",
};

/** What each band means, in the user's terms. Never a probability of being hired. */
export const MATCH_BAND_DESCRIPTIONS: Record<MatchBand, string> = {
  strong: "Your confirmed evidence covers most of the core skills, and your work is close to this role.",
  good: "Your confirmed evidence covers most of the core skills.",
  partial: "Your evidence covers some of the core skills. The gaps below show what to build or show.",
  low: "Little of your confirmed evidence covers this job's core skills yet.",
  excluded: "A requirement in the posting rules this job out for you. See the eligibility section.",
};

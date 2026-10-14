import type { ExtractedRequirement, MatchBand } from "@repo/core";
import { skillKey } from "@repo/core";
import type { EvalJob } from "./dataset";

export type EvalMode = "model" | "keywords";

/**
 * Release gates. Model runs gate the M3 acceptance metrics; keyword runs (no API key, as in CI)
 * guard the keyword reader against regressions. Baselines are recorded in docs/DECISIONS.md.
 */
export const EVAL_THRESHOLDS = {
  model: { extractionValidity: 0.9, explanationValidity: 0.9, verifiedShare: 0.9 },
  keywords: { extractionValidity: 1, skillRecall: 0.9 },
} as const;

type Requirement = Pick<ExtractedRequirement, "type" | "skill" | "eligibility">;
type SkillType = "core_skill" | "nice_to_have";

export type ExtractionScore = {
  skills: number;
  hits: number;
  typeMatches: number;
  missed: string[];
  /** Skills read from the posting that the labels don't list. Not penalised: labels cover asks only. */
  extra: string[];
  eligibility: number;
  eligibilityHits: number;
};

export function scoreExtraction(job: Pick<EvalJob, "labels">, requirements: readonly Requirement[]) {
  const found = new Map<string, SkillType>();
  for (const requirement of requirements) {
    if (requirement.type !== "core_skill" && requirement.type !== "nice_to_have") continue;
    if (!requirement.skill || found.get(requirement.skill) === "core_skill") continue;
    found.set(requirement.skill, requirement.type);
  }
  const labels: [string, SkillType][] = [
    ...job.labels.coreSkills.map((name): [string, SkillType] => [skillKey(name), "core_skill"]),
    ...job.labels.niceToHave.map((name): [string, SkillType] => [skillKey(name), "nice_to_have"]),
  ];
  let hits = 0;
  let typeMatches = 0;
  const missed: string[] = [];
  for (const [key, type] of labels) {
    const actual = found.get(key);
    if (!actual) {
      missed.push(key);
      continue;
    }
    hits++;
    if (actual === type) typeMatches++;
  }
  const labelled = new Set(labels.map(([key]) => key));
  const kinds = new Set(
    requirements.flatMap((requirement) =>
      requirement.type === "hard_eligibility" && requirement.eligibility
        ? [requirement.eligibility.kind]
        : [],
    ),
  );
  return {
    skills: labels.length,
    hits,
    typeMatches,
    missed,
    extra: [...found.keys()].filter((key) => !labelled.has(key)),
    eligibility: job.labels.eligibility.length,
    eligibilityHits: job.labels.eligibility.filter((kind) => kinds.has(kind)).length,
  } satisfies ExtractionScore;
}

const BAND_ORDER: MatchBand[] = ["low", "partial", "good", "strong"];

/** "near" is one step apart on the fit scale; "Not eligible" only agrees with itself. */
export function bandAgreement(expected: MatchBand, actual: MatchBand): "exact" | "near" | "off" {
  if (expected === actual) return "exact";
  if (expected === "excluded" || actual === "excluded") return "off";
  return Math.abs(BAND_ORDER.indexOf(expected) - BAND_ORDER.indexOf(actual)) === 1 ? "near" : "off";
}

export type JobResult = {
  id: string;
  method: string;
  requirements: number;
  attempts: number;
  validity: number;
  score: ExtractionScore;
};
export type PairResult = {
  job: string;
  profile: string;
  expected: MatchBand;
  /** Null when the analysis failed. */
  actual: MatchBand | null;
  coverage: number | null;
  /** Core skills with no confirmed evidence. */
  gaps: string[];
  status: "ready" | "fallback";
  /** One quote-validity rate per model attempt; empty when no model wrote an explanation. */
  validityRates: number[];
  /** The provider failed, so the structured overlap was shown instead. */
  explanationError: string | null;
  /** The analysis itself failed. */
  error: string | null;
};

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? null : numerator / denominator;
const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function summarize(mode: EvalMode, jobs: JobResult[], pairs: PairResult[]) {
  const attempted = pairs.filter((pair) => pair.validityRates.length > 0);
  const agreements = pairs.map((pair) => (pair.actual ? bandAgreement(pair.expected, pair.actual) : "off"));
  return {
    mode,
    jobs: jobs.length,
    pairs: pairs.length,
    extractionValidity: mean(jobs.map((job) => job.validity)),
    skillRecall: ratio(sum(jobs.map((job) => job.score.hits)), sum(jobs.map((job) => job.score.skills))),
    skillTypeAgreement: ratio(
      sum(jobs.map((job) => job.score.typeMatches)),
      sum(jobs.map((job) => job.score.hits)),
    ),
    // The keyword reader never reads eligibility, so recall there would only measure that choice.
    eligibilityRecall:
      mode === "model"
        ? ratio(
            sum(jobs.map((job) => job.score.eligibilityHits)),
            sum(jobs.map((job) => job.score.eligibility)),
          )
        : null,
    explanationValidityFirst: mean(attempted.map((pair) => pair.validityRates[0] ?? 0)),
    explanationValidity: mean(attempted.map((pair) => pair.validityRates.at(-1) ?? 0)),
    regenerated: attempted.filter((pair) => pair.validityRates.length > 1).length,
    verifiedShare: ratio(pairs.filter((pair) => pair.status === "ready").length, pairs.length),
    providerErrors: pairs.filter((pair) => pair.explanationError !== null).length,
    errors: pairs.filter((pair) => pair.error !== null).length,
    bandExact: ratio(agreements.filter((value) => value === "exact").length, pairs.length),
    bandNear: ratio(agreements.filter((value) => value !== "off").length, pairs.length),
  };
}
export type EvalSummary = ReturnType<typeof summarize>;

/** Each failed gate as a sentence; empty when the run passes. */
export function failedGates(summary: EvalSummary): string[] {
  const failures: string[] = [];
  const below = (name: string, value: number | null, minimum: number) => {
    if (value === null || value < minimum) {
      failures.push(`${name} ${value === null ? "was not measured" : value.toFixed(3)} (minimum ${minimum})`);
    }
  };
  if (summary.mode === "model") {
    const gates = EVAL_THRESHOLDS.model;
    below("Extraction quote validity", summary.extractionValidity, gates.extractionValidity);
    below("Explanation quote validity", summary.explanationValidity, gates.explanationValidity);
    below("Verified explanation share", summary.verifiedShare, gates.verifiedShare);
  } else {
    const gates = EVAL_THRESHOLDS.keywords;
    below("Extraction quote validity", summary.extractionValidity, gates.extractionValidity);
    below("Skill recall", summary.skillRecall, gates.skillRecall);
  }
  if (summary.errors > 0) failures.push(`${summary.errors} pair(s) failed with an error`);
  return failures;
}

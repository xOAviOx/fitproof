import { z } from "zod";
import { EVIDENCE_TIERS, type EvidenceTier } from "../vocab";

/**
 * Every tunable matching number lives here. Values are initial defaults
 * from the product spec; retune them against `data/eval` and record the
 * baseline in docs/DECISIONS.md whenever they change.
 */
export const SCORING_CONFIG = {
  evidenceWeights: {
    paid_work: 1.0,
    internship: 0.9,
    project: 0.7,
    coursework_or_certification: 0.5,
    self_declared: 0.3,
  } satisfies Record<EvidenceTier, number>,
  bands: {
    strong: { minCoreCoverage: 0.8, minResponsibilitySimilarity: 0.55 },
    good: { minCoreCoverage: 0.6 },
    partial: { minCoreCoverage: 0.4 },
  },
  /** Ordering only; users see bands. Missing coverage counts as `neutralCoverage`. */
  ordering: { coverage: 0.6, similarity: 0.3, preferences: 0.1, neutralCoverage: 0.5 },
  almostQualified: { maxMissingCoreSkills: 2 },
  retrieval: { candidateLimit: 200 },
  explanations: { precomputeTopN: 30, maxQuoteFailureRate: 0.3 },
  freshness: { staleAfterHours: 48 },
  /** Experience within this many months of a band's edge becomes a "check", never an exclusion. */
  eligibility: { experienceGraceMonths: 6 },
} as const;

const unitInterval = z.number().gt(0).lte(1);

export const scoringConfigSchema = z
  .object({
    evidenceWeights: z.record(z.enum(EVIDENCE_TIERS), unitInterval),
    bands: z.object({
      strong: z.object({ minCoreCoverage: unitInterval, minResponsibilitySimilarity: unitInterval }),
      good: z.object({ minCoreCoverage: unitInterval }),
      partial: z.object({ minCoreCoverage: unitInterval }),
    }),
    ordering: z.object({
      coverage: unitInterval,
      similarity: unitInterval,
      preferences: unitInterval,
      neutralCoverage: unitInterval,
    }),
    almostQualified: z.object({ maxMissingCoreSkills: z.number().int().min(0) }),
    retrieval: z.object({ candidateLimit: z.number().int().positive() }),
    explanations: z.object({
      precomputeTopN: z.number().int().positive(),
      maxQuoteFailureRate: unitInterval,
    }),
    freshness: z.object({ staleAfterHours: z.number().positive() }),
    eligibility: z.object({ experienceGraceMonths: z.number().int().min(0).max(24) }),
  })
  .refine(
    (c) =>
      c.bands.strong.minCoreCoverage > c.bands.good.minCoreCoverage &&
      c.bands.good.minCoreCoverage > c.bands.partial.minCoreCoverage,
    { message: "Band thresholds must be strictly descending: strong > good > partial" },
  );

export type ScoringConfig = typeof SCORING_CONFIG;

import type { Explanation, ExplanationOutput, GapResponse, MatchResult } from "@repo/core";

export const STORED_MATCH_VERSION = 1;
export type ExtractionMethod = "model" | "keywords";

/** `matches.score_breakdown`: the deterministic result. Users see the band, never the score. */
export type StoredScore = MatchResult & {
  version: typeof STORED_MATCH_VERSION;
  /** Hash of the compared texts, so a refresh can reuse `similarity` without embedding again. */
  similarityHash: string;
};

/** `matches.explanation` */
export type StoredExplanation = {
  version: typeof STORED_MATCH_VERSION;
  extraction: ExtractionMethod;
  explanation: Explanation;
  /** Raw model output, re-verified on refresh instead of calling the model again. */
  model: { output: ExplanationOutput; requirementIds: string[]; evidenceHash: string } | null;
};

type MatchRow = {
  scoreBreakdown: Record<string, unknown>;
  explanation: Record<string, unknown> | null;
};

/** Null for rows written by an older version; those are recomputed on the next check. */
export function readStoredMatch(row: MatchRow | null) {
  if (
    !row ||
    row.scoreBreakdown.version !== STORED_MATCH_VERSION ||
    row.explanation?.version !== STORED_MATCH_VERSION
  ) {
    return null;
  }
  return {
    score: row.scoreBreakdown as unknown as StoredScore,
    explanation: row.explanation as unknown as StoredExplanation,
  };
}

/** Gap answers change without re-scoring, so overlay the current ones when showing an explanation. */
export function withGapResponses(
  explanation: Explanation,
  responses: ReadonlyMap<string, GapResponse>,
): Explanation {
  return {
    ...explanation,
    gaps: explanation.gaps.map((gap) => ({ ...gap, response: responses.get(gap.requirementId) ?? null })),
  };
}

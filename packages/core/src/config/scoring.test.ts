import { describe, expect, it } from "vitest";
import { EVIDENCE_TIERS } from "../vocab";
import { SCORING_CONFIG, scoringConfigSchema } from "./scoring";

describe("SCORING_CONFIG", () => {
  it("passes its own schema", () => {
    expect(() => scoringConfigSchema.parse(SCORING_CONFIG)).not.toThrow();
  });

  it("weights stronger evidence tiers higher", () => {
    const weights = EVIDENCE_TIERS.map((tier) => SCORING_CONFIG.evidenceWeights[tier]);
    const sortedDescending = [...weights].sort((a, b) => b - a);
    expect(weights).toEqual(sortedDescending);
  });

  it("rejects band thresholds that are not descending", () => {
    const broken = {
      ...SCORING_CONFIG,
      bands: { ...SCORING_CONFIG.bands, good: { minCoreCoverage: 0.9 } },
    };
    expect(scoringConfigSchema.safeParse(broken).success).toBe(false);
  });
});

import { mentionsSkill, skillKey } from "@repo/core";
import { describe, expect, it } from "vitest";
import { loadDataset } from "./dataset";
import {
  bandAgreement,
  failedGates,
  type JobResult,
  type PairResult,
  scoreExtraction,
  summarize,
} from "./metrics";

describe("eval dataset", () => {
  it("loads, and every labelled skill is named in its posting", async () => {
    const dataset = await loadDataset();
    expect(dataset.jobs.length).toBeGreaterThanOrEqual(10);
    expect(new Set(dataset.jobs.map((job) => job.family)).size).toBe(3);
    for (const job of dataset.jobs) {
      for (const label of [...job.labels.coreSkills, ...job.labels.niceToHave]) {
        expect(mentionsSkill(job.text, skillKey(label)), `${job.id}: ${label}`).toBe(true);
      }
    }
  });
});

const requirement = (type: "core_skill" | "nice_to_have" | "hard_eligibility", skill: string | null) => ({
  type,
  skill,
  eligibility:
    type === "hard_eligibility"
      ? { kind: "graduation_batch" as const, quote: "", value: { years: [2025] } }
      : null,
});

describe("eval metrics", () => {
  it("scores skill recall, type agreement, and eligibility recall against labels", () => {
    const score = scoreExtraction(
      {
        labels: {
          coreSkills: ["ReactJS", "SQL"],
          niceToHave: ["Docker"],
          eligibility: ["graduation_batch", "degree"],
        },
      },
      [
        requirement("core_skill", "react"),
        requirement("core_skill", "docker"),
        requirement("nice_to_have", "kafka"),
        requirement("hard_eligibility", null),
      ],
    );
    expect(score).toMatchObject({ skills: 3, hits: 2, typeMatches: 1, missed: ["sql"], extra: ["kafka"] });
    expect(score).toMatchObject({ eligibility: 2, eligibilityHits: 1 });
  });

  it("treats Not eligible as its own band", () => {
    expect(bandAgreement("good", "good")).toBe("exact");
    expect(bandAgreement("good", "strong")).toBe("near");
    expect(bandAgreement("good", "low")).toBe("off");
    expect(bandAgreement("excluded", "low")).toBe("off");
  });

  it("gates model runs on final quote validity and the verified share", () => {
    const job: JobResult = {
      id: "j",
      method: "model",
      requirements: 5,
      attempts: 1,
      validity: 0.95,
      score: {
        skills: 2,
        hits: 2,
        typeMatches: 2,
        missed: [],
        extra: [],
        eligibility: 0,
        eligibilityHits: 0,
      },
    };
    const pair = (validityRates: number[], status: PairResult["status"]): PairResult => ({
      job: "j",
      profile: "p",
      expected: "good",
      actual: "good",
      coverage: 0.7,
      gaps: [],
      status,
      validityRates,
      explanationError: null,
      error: null,
    });
    const passing = summarize("model", [job], [pair([0.6, 1], "ready"), pair([0.95], "ready")]);
    expect(passing.explanationValidityFirst).toBeCloseTo(0.775);
    expect(passing.explanationValidity).toBeCloseTo(0.975);
    expect(passing.regenerated).toBe(1);
    expect(failedGates(passing)).toEqual([]);
    const failing = summarize("model", [job], [pair([0.5, 0.6], "fallback"), pair([1], "ready")]);
    expect(failedGates(failing)).toEqual([
      "Explanation quote validity 0.800 (minimum 0.9)",
      "Verified explanation share 0.500 (minimum 0.9)",
    ]);
  });
});

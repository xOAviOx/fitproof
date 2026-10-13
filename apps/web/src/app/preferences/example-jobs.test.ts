import {
  emptyPreferences,
  evaluateJobEligibility,
  hardRequirementSchema,
  type Preferences,
} from "@repo/core";
import { describe, expect, it } from "vitest";
import { EXAMPLE_JOBS } from "./example-jobs";

const fresher: Preferences = {
  ...emptyPreferences(),
  desiredRoles: ["backend"],
  employmentTypes: ["full_time", "internship"],
  remotePreference: "hybrid",
  locations: ["Bengaluru"],
  willingToRelocate: false,
  graduationYear: 2026,
  degree: "B.Tech / B.E.",
  branch: "Computer Science",
};

describe("example postings", () => {
  it("contain only valid structured requirements with quotes", () => {
    for (const example of EXAMPLE_JOBS) {
      for (const requirement of example.job.requirements) {
        expect(
          hardRequirementSchema.safeParse(requirement).success,
          `${example.id}:${requirement.kind}`,
        ).toBe(true);
      }
    }
    expect(new Set(EXAMPLE_JOBS.map((example) => example.id)).size).toBe(EXAMPLE_JOBS.length);
  });
  it("demonstrate every outcome for a typical fresher", () => {
    const outcomes = EXAMPLE_JOBS.map(
      (example) =>
        evaluateJobEligibility(
          { preferences: fresher, experience: { paidMonths: 0, internshipMonths: 3 } },
          example.job,
          "2026-10-14",
        ).outcome,
    );
    expect(new Set(outcomes)).toEqual(new Set(["eligible", "check", "excluded"]));
  });
});

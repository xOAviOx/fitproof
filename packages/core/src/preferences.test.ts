import { describe, expect, it } from "vitest";
import {
  describeFilters,
  emptyPreferences,
  formatLpa,
  normalizePreferences,
  type Preferences,
  preferencesSchema,
} from "./preferences";

const valid = (overrides: Partial<Preferences> = {}): Preferences => ({
  ...emptyPreferences(),
  desiredRoles: ["backend"],
  employmentTypes: ["full_time"],
  remotePreference: "hybrid",
  locations: ["Bengaluru"],
  ...overrides,
});
const issues = (value: unknown) => {
  const result = preferencesSchema.safeParse(value);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("preferences validation", () => {
  it("accepts a complete set of preferences", () => {
    expect(
      preferencesSchema.safeParse(
        valid({
          willingToRelocate: false,
          minAnnualSalaryInr: 600_000,
          noticePeriodDays: 30,
          availableFrom: "2026-07-01",
          graduationYear: 2026,
          degree: "B.Tech / B.E.",
          branch: "Computer Science",
          scoreType: "cgpa",
          score: 8.2,
          scoreScale: 10,
          workAuthorization: "authorized",
        }),
      ).success,
    ).toBe(true);
  });
  it("requires roles, job types, and a city unless remote-only", () => {
    expect(issues(emptyPreferences())).toMatchObject({
      desiredRoles: "Choose at least one role.",
      employmentTypes: "Choose at least one job type.",
      locations: "Choose at least one city, or choose remote only.",
    });
    expect(issues(valid({ remotePreference: "remote", locations: [] }))).toEqual({});
    expect(issues(valid({ locations: ["Remote"] }))).toHaveProperty("locations");
  });
  it("validates scores against their type and scale", () => {
    expect(issues(valid({ score: 8, scoreType: null }))).toHaveProperty("scoreType");
    expect(issues(valid({ score: 8, scoreType: "cgpa", scoreScale: 7 }))).toHaveProperty("scoreScale");
    expect(issues(valid({ score: 11, scoreType: "cgpa", scoreScale: 10 }))).toEqual({
      score: "Enter a score up to 10.",
    });
    expect(issues(valid({ score: 78, scoreType: "percentage", scoreScale: null }))).toEqual({});
  });
  it("rejects out-of-range numbers and invalid dates", () => {
    expect(issues(valid({ minAnnualSalaryInr: 1000 }))).toHaveProperty("minAnnualSalaryInr");
    expect(issues(valid({ noticePeriodDays: 365 }))).toHaveProperty("noticePeriodDays");
    expect(issues(valid({ graduationYear: 26 }))).toHaveProperty("graduationYear");
    expect(issues(valid({ availableFrom: "2026-02-30" }))).toHaveProperty("availableFrom");
    expect(issues(valid({ desiredRoles: ["devops" as "backend"] }))).toHaveProperty("desiredRoles.0");
  });
});

describe("normalizePreferences", () => {
  it("canonicalizes and deduplicates cities, drops remote words, and orders choices", () => {
    const normalized = normalizePreferences(
      valid({
        desiredRoles: ["data_analyst", "backend", "backend"],
        employmentTypes: ["internship", "full_time"],
        locations: ["Bangalore", "bengaluru", "Remote", " Kochi  Metro ", "Pune"],
      }),
    );
    expect(normalized.locations).toEqual(["Bengaluru", "Kochi", "Pune"]);
    expect(normalized.desiredRoles).toEqual(["backend", "data_analyst"]);
    expect(normalized.employmentTypes).toEqual(["full_time", "internship"]);
    expect(normalizePreferences(normalized)).toEqual(normalized);
  });
  it("keeps unknown cities as typed and clears incomplete scores", () => {
    expect(normalizePreferences(valid({ locations: ["Springfield"] })).locations).toEqual(["Springfield"]);
    expect(normalizePreferences(valid({ scoreType: "cgpa", scoreScale: 10, score: null }))).toMatchObject({
      score: null,
      scoreType: null,
      scoreScale: null,
    });
    expect(
      normalizePreferences(valid({ scoreType: "percentage", score: 80, scoreScale: null })).scoreScale,
    ).toBe(100);
  });
});

describe("describeFilters", () => {
  it("explains every field and how missing values become checks", () => {
    const rules = describeFilters(valid(), null);
    expect(rules.map((rule) => rule.id)).toEqual([
      "roles",
      "employmentTypes",
      "remotePreference",
      "locations",
      "minAnnualSalaryInr",
      "availability",
      "graduationYear",
      "degree",
      "score",
      "workAuthorization",
      "experience",
    ]);
    const byId = Object.fromEntries(rules.map((rule) => [rule.id, rule]));
    expect(byId.locations).toMatchObject({ kind: "missing", value: "Bengaluru" });
    expect(byId.graduationYear?.kind).toBe("missing");
    expect(byId.experience?.value).toBe("Unknown");
    expect(byId.employmentTypes?.effect).toContain(
      "internship, contract, and part-time roles are filtered out",
    );
  });
  it("reflects saved values in plain language", () => {
    const rules = describeFilters(
      valid({
        willingToRelocate: false,
        locations: ["Bengaluru", "Pune"],
        minAnnualSalaryInr: 650_000,
        noticePeriodDays: 0,
        graduationYear: 2026,
        degree: "B.Tech",
        branch: "CSE",
        scoreType: "cgpa",
        score: 8.2,
        scoreScale: 10,
        workAuthorization: "authorized",
      }),
      { paidMonths: 0, internshipMonths: 6 },
    );
    const byId = Object.fromEntries(rules.map((rule) => [rule.id, rule]));
    expect(byId.locations?.effect).toBe("Office and hybrid jobs outside Bengaluru or Pune are filtered out.");
    expect(byId.minAnnualSalaryInr?.value).toBe("At least ₹6.5 LPA");
    expect(byId.availability?.value).toBe("Available immediately");
    expect(byId.score?.value).toBe("8.2/10 CGPA");
    expect(byId.experience?.value).toBe("No paid work experience");
    expect(rules.filter((rule) => rule.kind === "missing")).toEqual([]);
    expect(
      describeFilters(valid({ remotePreference: "remote" }), null).some((r) => r.id === "locations"),
    ).toBe(false);
  });
  it("formats salaries in lakhs per annum", () => {
    expect(formatLpa(600_000)).toBe("₹6 LPA");
    expect(formatLpa(1_250_000)).toBe("₹12.5 LPA");
  });
});

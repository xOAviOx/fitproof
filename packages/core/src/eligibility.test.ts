import { describe, expect, it } from "vitest";
import {
  type CandidateFacts,
  evaluateJobEligibility,
  type HardRequirement,
  hardRequirementSchema,
  type JobFacts,
  parseHardRequirement,
  summarizeExperience,
} from "./eligibility";
import { emptyPreferences, type Preferences } from "./preferences";
import { emptyProfile, type ProfileContent } from "./profile";
import { ELIGIBILITY_KINDS } from "./vocab";

const TODAY = "2026-10-14";
const prefs = (overrides: Partial<Preferences> = {}): Preferences => ({
  ...emptyPreferences(),
  desiredRoles: ["backend", "data_analyst"],
  employmentTypes: ["full_time", "internship"],
  remotePreference: "hybrid",
  locations: ["Bengaluru", "Pune"],
  willingToRelocate: false,
  ...overrides,
});
const job = (overrides: Partial<JobFacts> = {}): JobFacts => ({
  roleFamily: "backend",
  locations: ["Bengaluru, Karnataka"],
  remoteType: "hybrid",
  employmentType: "full_time",
  salary: null,
  requirements: [],
  ...overrides,
});
const candidate = (
  preferences: Preferences | null = prefs(),
  paidMonths: number | null = 0,
): CandidateFacts => ({
  preferences,
  experience: paidMonths === null ? null : { paidMonths, internshipMonths: 0 },
});
const requirement = <K extends HardRequirement["kind"]>(
  kind: K,
  value: Extract<HardRequirement, { kind: K }>["value"],
): HardRequirement => hardRequirementSchema.parse({ kind, value, quote: `Quote about ${kind}.` });
const evaluate = (c: CandidateFacts, j: JobFacts) => evaluateJobEligibility(c, j, TODAY);
const only = (c: CandidateFacts, r: HardRequirement) => {
  const result = evaluate(c, job({ requirements: [r] }));
  const found = result.checks.find((item) => item.source === "requirement");
  if (!found) throw new Error("No requirement check");
  return found;
};
const preference = (c: CandidateFacts, j: JobFacts, kind: string) =>
  evaluate(c, j).checks.find((item) => item.source === "preference" && item.kind === kind);

describe("hard requirement schema", () => {
  it("has a structured value for every eligibility kind", () => {
    const kinds = hardRequirementSchema.options.map((option) => option.shape.kind.value);
    expect([...kinds].sort()).toEqual([...ELIGIBILITY_KINDS].sort());
  });
  it("parses stored rows and rejects incomplete values", () => {
    expect(
      parseHardRequirement({
        eligibilityKind: "graduation_batch",
        eligibilityValue: { years: [2026] },
        quote: "2026 batch only",
      }),
    ).toEqual({ kind: "graduation_batch", value: { years: [2026] }, quote: "2026 batch only" });
    expect(
      parseHardRequirement({ eligibilityKind: "experience_band", eligibilityValue: {}, quote: "x" }),
    ).toBeNull();
    expect(parseHardRequirement({ eligibilityKind: null, eligibilityValue: null, quote: "x" })).toBeNull();
    expect(
      hardRequirementSchema.safeParse({
        kind: "experience_band",
        quote: "x",
        value: { minYears: 3, maxYears: 1 },
      }).success,
    ).toBe(false);
  });
});

describe("summarizeExperience", () => {
  const entry = (
    tier: "paid_work" | "internship",
    startDate: string | null,
    endDate: string | null,
    isCurrent = false,
  ): ProfileContent["experiences"][number] => ({
    tier,
    company: "Example",
    title: "Engineer",
    location: null,
    startDate,
    endDate,
    isCurrent,
    bullets: [],
    skills: [],
    sourceText: null,
    userConfirmed: true,
  });
  const profile = (...experiences: ProfileContent["experiences"]) => ({ ...emptyProfile(), experiences });

  it("counts overlapping paid work once and keeps internships separate", () => {
    expect(
      summarizeExperience(
        profile(
          entry("paid_work", "2024-01-01", "2024-12-31"),
          entry("paid_work", "2024-07-01", "2025-06-30"),
          entry("internship", "2023-05-01", "2023-07-31"),
        ),
        TODAY,
      ),
    ).toEqual({ paidMonths: 18, internshipMonths: 3 });
  });
  it("counts a current role up to today and caps future end dates", () => {
    expect(summarizeExperience(profile(entry("paid_work", "2025-10-14", null, true)), TODAY).paidMonths).toBe(
      12,
    );
    expect(
      summarizeExperience(profile(entry("paid_work", "2026-04-14", "2030-01-01")), TODAY).paidMonths,
    ).toBe(6);
  });
  it("returns unknown when an entry is undated, and zero with no entries", () => {
    expect(summarizeExperience(profile(entry("paid_work", null, "2024-01-01")), TODAY)).toEqual({
      paidMonths: null,
      internshipMonths: 0,
    });
    expect(summarizeExperience(emptyProfile(), TODAY)).toEqual({ paidMonths: 0, internshipMonths: 0 });
  });
});

describe("preference filters", () => {
  it("passes a job that matches every preference", () => {
    const result = evaluate(candidate(), job());
    expect(result.outcome).toBe("eligible");
    expect(result.checks.map((c) => [c.kind, c.status])).toEqual([
      ["role", "met"],
      ["work_mode", "met"],
      ["location", "met"],
      ["employment_type", "met"],
    ]);
  });
  it("excludes other role families and asks when the role is unclassified", () => {
    expect(preference(candidate(), job({ roleFamily: "frontend" }), "role")).toMatchObject({
      status: "unmet",
      message:
        "This is a Frontend Developer role. You're looking for Backend / Software Developer or Data Analyst.",
    });
    expect(preference(candidate(), job({ roleFamily: null }), "role")?.status).toBe("check");
  });
  it("applies each work-mode preference as a set of accepted modes", () => {
    const status = (remotePreference: Preferences["remotePreference"], remoteType: JobFacts["remoteType"]) =>
      preference(candidate(prefs({ remotePreference })), job({ remoteType }), "work_mode")?.status ?? "none";
    expect(status("remote", "remote")).toBe("met");
    expect(status("remote", "hybrid")).toBe("unmet");
    expect(status("hybrid", "onsite")).toBe("unmet");
    expect(status("onsite", "remote")).toBe("unmet");
    expect(status("onsite", "hybrid")).toBe("met");
    expect(status("hybrid", "unknown")).toBe("check");
    expect(status("any", "onsite")).toBe("none");
  });
  it("filters office jobs by city, honoring relocation and unknown values", () => {
    const chennai = job({ locations: ["Chennai"] });
    const location = (overrides: Partial<Preferences>, j = chennai) =>
      preference(candidate(prefs(overrides)), j, "location");
    expect(location({})?.status).toBe("unmet");
    expect(location({ willingToRelocate: true })?.status).toBe("met");
    expect(location({ willingToRelocate: null })?.status).toBe("check");
    expect(location({}, job({ locations: ["Bangalore"] }))?.status).toBe("met");
    expect(location({}, job({ locations: ["Springfield"] }))?.status).toBe("check");
    expect(location({}, job({ locations: [] }))?.status).toBe("check");
    expect(location({}, job({ locations: ["Chennai"], remoteType: "remote" }))).toBeUndefined();
    expect(location({ locations: ["Kochi Infopark"] }, job({ locations: ["Kochi"] }))?.status).toBe("met");
  });
  it("filters job types only when some are excluded", () => {
    expect(preference(candidate(), job({ employmentType: "contract" }), "employment_type")?.status).toBe(
      "unmet",
    );
    expect(preference(candidate(), job({ employmentType: "unknown" }), "employment_type")?.status).toBe(
      "check",
    );
    const all = prefs({ employmentTypes: ["full_time", "internship", "contract", "part_time"] });
    expect(
      preference(candidate(all), job({ employmentType: "contract" }), "employment_type"),
    ).toBeUndefined();
  });
  it("compares only published INR salaries and never internship stipends", () => {
    const withMinimum = candidate(prefs({ minAnnualSalaryInr: 600_000 }));
    const salary = (s: JobFacts["salary"], employmentType: JobFacts["employmentType"] = "full_time") =>
      preference(withMinimum, job({ salary: s, employmentType }), "salary");
    expect(salary({ min: 300_000, max: 500_000, currency: "INR", period: "year" })).toMatchObject({
      status: "unmet",
      message: "Published pay is up to ₹5 LPA, below your minimum of ₹6 LPA.",
    });
    expect(salary({ min: null, max: 60_000, currency: "inr", period: "Monthly" })?.status).toBe("met");
    expect(salary({ min: 400_000, max: null, currency: "INR", period: "annual" })?.status).toBe("check");
    expect(salary({ min: 1, max: 2, currency: "USD", period: "year" })).toBeUndefined();
    expect(salary({ min: 1, max: 2, currency: "INR", period: null })).toBeUndefined();
    expect(
      salary({ min: 10_000, max: 20_000, currency: "INR", period: "month" }, "internship"),
    ).toBeUndefined();
    expect(salary(null)).toBeUndefined();
  });
});

describe("hard requirements", () => {
  it("never excludes when the candidate's value is unknown", () => {
    const requirements: HardRequirement[] = [
      requirement("location", { cities: ["Chennai"], relocationAccepted: false }),
      requirement("work_authorization", { country: "IN", sponsorshipAvailable: false }),
      requirement("degree", {
        levels: ["master"],
        degrees: ["M.Tech"],
        fields: ["Computer Science"],
        allowRelated: false,
        minScores: [{ type: "percentage", value: 60, scale: 100 }],
      }),
      requirement("graduation_batch", { years: [2025] }),
      requirement("experience_band", { minYears: 3, maxYears: null }),
      requirement("availability", { joinWithinDays: 0, startBy: null }),
    ];
    const unknownPreferences = prefs({ locations: [], remotePreference: "remote", willingToRelocate: null });
    for (const c of [candidate(unknownPreferences, null), candidate(null, null)]) {
      const result = evaluate(c, job({ remoteType: "remote", requirements }));
      expect(result.outcome).toBe("check");
      expect(
        result.checks.filter((item) => item.source === "requirement").map((item) => item.status),
      ).toEqual(requirements.map(() => "check"));
    }
  });
  it("keeps the verbatim quote on every requirement check", () => {
    const result = only(candidate(), requirement("graduation_batch", { years: [2026] }));
    expect(result).toMatchObject({ source: "requirement", quote: "Quote about graduation_batch." });
  });
  it("checks graduation batches exactly", () => {
    const batch = requirement("graduation_batch", { years: [2025, 2026] });
    expect(only(candidate(prefs({ graduationYear: 2026 })), batch).status).toBe("met");
    expect(only(candidate(prefs({ graduationYear: 2024 })), batch)).toMatchObject({
      status: "unmet",
      message: "Open to the 2025 and 2026 batches. Your graduation year is 2024.",
    });
  });
  it("checks work authorization for India and asks about other countries", () => {
    const india = (sponsorshipAvailable: boolean | null) =>
      requirement("work_authorization", { country: "IN", sponsorshipAvailable });
    const authorized = candidate(prefs({ workAuthorization: "authorized" }));
    const sponsored = candidate(prefs({ workAuthorization: "needs_sponsorship" }));
    expect(only(authorized, india(false)).status).toBe("met");
    expect(only(sponsored, india(false)).status).toBe("unmet");
    expect(only(sponsored, india(true)).status).toBe("met");
    expect(only(sponsored, india(null)).status).toBe("check");
    expect(
      only(authorized, requirement("work_authorization", { country: "US", sponsorshipAvailable: false })),
    ).toMatchObject({ status: "check", message: expect.stringContaining("United States") });
  });
  it("checks required locations against cities and relocation", () => {
    const based = requirement("location", { cities: ["Hyderabad"], relocationAccepted: false });
    const relocate = requirement("location", { cities: ["Hyderabad"], relocationAccepted: true });
    expect(only(candidate(prefs({ locations: ["Secunderabad"] })), based).status).toBe("met");
    expect(only(candidate(), based).status).toBe("unmet");
    expect(only(candidate(prefs({ willingToRelocate: true })), relocate).status).toBe("met");
    expect(only(candidate(prefs({ willingToRelocate: true })), based).status).toBe("check");
    expect(
      only(candidate(), requirement("location", { cities: ["Atlantis"], relocationAccepted: false })).status,
    ).toBe("check");
  });

  describe("degree", () => {
    const degree = (value: Partial<Extract<HardRequirement, { kind: "degree" }>["value"]>) =>
      requirement("degree", {
        levels: [],
        degrees: [],
        fields: [],
        allowRelated: false,
        minScores: [],
        ...value,
      });
    const holder = (overrides: Partial<Preferences>) =>
      candidate(prefs({ degree: "B.Tech", branch: "Computer Science", ...overrides }));

    it("matches degree names, levels, and branches", () => {
      expect(only(holder({}), degree({ degrees: ["B.E.", "B.Tech"], fields: ["CSE", "IT"] })).status).toBe(
        "met",
      );
      expect(only(holder({}), degree({ levels: ["bachelor", "master"] })).status).toBe("met");
      expect(only(holder({ degree: "Diploma" }), degree({ levels: ["bachelor"] })).status).toBe("unmet");
      expect(only(holder({}), degree({ levels: ["master"] })).status).toBe("unmet");
      expect(only(holder({ degree: "M.Tech" }), degree({ degrees: ["B.Tech"] })).status).toBe("check");
    });
    it("excludes known mismatches but only checks equivalents and unrecognized values", () => {
      expect(only(holder({ degree: "BCA" }), degree({ degrees: ["B.Tech", "B.E."] })).status).toBe("unmet");
      expect(
        only(holder({ degree: "BCA" }), degree({ degrees: ["B.Tech"], allowRelated: true })).status,
      ).toBe("check");
      expect(only(holder({ degree: "Integrated dual" }), degree({ degrees: ["B.Tech"] })).status).toBe(
        "check",
      );
      expect(only(holder({}), degree({ degrees: ["B.Arch"] })).status).toBe("check");
      expect(only(holder({ branch: "Mechanical" }), degree({ fields: ["CS", "IT"] })).status).toBe("unmet");
      expect(
        only(holder({ branch: "Mechanical" }), degree({ fields: ["CS"], allowRelated: true })).status,
      ).toBe("check");
      expect(only(holder({ branch: "Liberal studies" }), degree({ fields: ["CS"] })).status).toBe("check");
      expect(only(holder({ branch: null }), degree({ fields: ["CS"] })).status).toBe("check");
    });
    it("compares scores only on the same scale", () => {
      const cutoff = degree({ minScores: [{ type: "cgpa", value: 7, scale: 10 }] });
      const either = degree({
        minScores: [
          { type: "percentage", value: 60, scale: 100 },
          { type: "cgpa", value: 6.5, scale: 10 },
        ],
      });
      const cgpa = (score: number, scoreScale = 10) => holder({ scoreType: "cgpa", score, scoreScale });
      expect(only(cgpa(8.2), cutoff).status).toBe("met");
      expect(only(cgpa(6.4), cutoff)).toMatchObject({
        status: "unmet",
        message: "Asks for at least 7/10 CGPA. Your score is 6.4/10 CGPA.",
      });
      expect(only(cgpa(3.5, 4), cutoff).status).toBe("check");
      expect(only(cgpa(6.6), either).status).toBe("met");
      expect(only(cgpa(6), either).status).toBe("check");
      expect(only(holder({ scoreType: "percentage", score: 55, scoreScale: 100 }), either).status).toBe(
        "check",
      );
    });
    it("lets a known failure in one part exclude the requirement", () => {
      const combined = degree({ degrees: ["B.Tech"], fields: ["Mechanical"] });
      const result = only(holder({}), combined);
      expect(result).toMatchObject({
        status: "unmet",
        message: "Asks for Mechanical. Your branch is Computer Science.",
      });
    });
  });

  it("applies experience bands with a grace margin and internship check", () => {
    const atLeast = (minYears: number) => requirement("experience_band", { minYears, maxYears: null });
    const upTo = (maxYears: number) => requirement("experience_band", { minYears: 0, maxYears });
    const exp = (paidMonths: number, internshipMonths = 0): CandidateFacts => ({
      preferences: prefs(),
      experience: { paidMonths, internshipMonths },
    });
    expect(only(exp(0), upTo(1)).status).toBe("met");
    expect(only(exp(36), atLeast(3)).status).toBe("met");
    expect(only(exp(0), atLeast(2))).toMatchObject({
      status: "unmet",
      message: "Asks for 2+ years of experience. Your confirmed profile shows no paid work experience.",
    });
    expect(only(exp(20), atLeast(2)).status).toBe("check");
    expect(only(exp(6, 12), atLeast(1.5)).status).toBe("check");
    expect(
      only({ preferences: prefs(), experience: { paidMonths: 0, internshipMonths: null } }, atLeast(2))
        .status,
    ).toBe("check");
    expect(only(exp(28), upTo(2)).status).toBe("check");
    expect(only(exp(48), upTo(2)).status).toBe("unmet");
    expect(only(exp(48), atLeast(1)).status).toBe("met");
  });
  it("compares joining deadlines with notice period and start date", () => {
    const immediate = requirement("availability", { joinWithinDays: 15, startBy: null });
    const byDate = requirement("availability", { joinWithinDays: null, startBy: "2027-01-15" });
    expect(only(candidate(prefs({ noticePeriodDays: 0 })), immediate)).toMatchObject({
      status: "met",
      message: "You can start immediately, which meets joining within 15 days.",
    });
    expect(only(candidate(prefs({ noticePeriodDays: 60 })), immediate).status).toBe("unmet");
    expect(only(candidate(prefs({ availableFrom: "2027-01-01" })), byDate).status).toBe("met");
    expect(only(candidate(prefs({ availableFrom: "2027-07-01" })), byDate)).toMatchObject({
      status: "unmet",
      message: "Asks for a start by 15 Jan 2027. The earliest you can start is 1 Jul 2027.",
    });
    expect(only(candidate(prefs({ availableFrom: "2020-01-01" })), immediate).status).toBe("met");
    expect(
      only(candidate(prefs({ availableFrom: "2026-11-01", noticePeriodDays: 0 })), immediate).status,
    ).toBe("unmet");
  });
});

describe("outcome", () => {
  it("excludes only on a known failure, and lists every reason", () => {
    const result = evaluate(
      candidate(prefs({ graduationYear: 2024 })),
      job({
        locations: ["Chennai"],
        requirements: [
          requirement("graduation_batch", { years: [2026] }),
          requirement("work_authorization", { country: "IN", sponsorshipAvailable: null }),
        ],
      }),
    );
    expect(result.outcome).toBe("excluded");
    expect(result.checks.filter((c) => c.status === "unmet").map((c) => c.kind)).toEqual([
      "location",
      "graduation_batch",
    ]);
    expect(result.checks.find((c) => c.kind === "work_authorization")?.status).toBe("check");
  });
  it("returns check when nothing fails but something is unclear", () => {
    expect(evaluate(candidate(), job({ employmentType: "unknown" })).outcome).toBe("check");
  });
  it("skips preference filters when preferences are not set", () => {
    expect(evaluate(candidate(null), job({ roleFamily: "frontend" }))).toEqual({
      outcome: "eligible",
      checks: [],
    });
  });
});

import { describe, expect, it } from "vitest";
import { hardRequirementSchema } from "./eligibility";
import {
  buildExplanation,
  cosineSimilarity,
  findSkillEvidence,
  type MatchInput,
  profileEvidence,
  requirementRef,
  type StoredRequirement,
  scoreMatch,
  similarityTexts,
  verifyExplanation,
} from "./matching";
import { emptyPreferences, type Preferences } from "./preferences";
import { emptyProfile, type ProfileContent } from "./profile";

const TODAY = "2026-10-14";
const DESCRIPTION =
  "Must know Node.js. PostgreSQL is required. Kafka is a plus. Graduates of 2026 only. Design REST APIs. Final-year students may apply.";

const profile = (): ProfileContent => ({
  ...emptyProfile(),
  experiences: [
    {
      tier: "internship",
      company: "Acme",
      title: "Backend Intern",
      location: null,
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      isCurrent: false,
      bullets: ["Built payment APIs in Node.js and Express", "Wrote PostgreSQL migrations for billing"],
      skills: ["Node.js", "PostgreSQL"],
      sourceText: "Backend Intern, Acme. Built payment APIs in Node.js and Express.",
      userConfirmed: true,
    },
    {
      tier: "paid_work",
      company: "Hidden Co",
      title: "Engineer",
      location: null,
      startDate: null,
      endDate: null,
      isCurrent: false,
      bullets: ["Ran Kafka clusters"],
      skills: [],
      sourceText: null,
      userConfirmed: false,
    },
  ],
  projects: [
    {
      name: "Ledger",
      description: "Double-entry ledger in Node.js",
      url: null,
      bullets: [],
      skills: ["Node.js"],
      sourceText: null,
      userConfirmed: true,
    },
  ],
  skills: [{ name: "Docker", tier: "self_declared", sourceText: null, userConfirmed: true }],
});

const requirement = (id: string, overrides: Partial<StoredRequirement>): StoredRequirement => ({
  id,
  type: "core_skill",
  text: overrides.skill ?? "",
  quote: "",
  skill: null,
  eligibility: null,
  ...overrides,
});
const REQUIREMENTS: StoredRequirement[] = [
  requirement("r1", { skill: "nodejs", text: "Node.js", quote: "Must know Node.js." }),
  requirement("r2", { skill: "postgresql", text: "PostgreSQL", quote: "PostgreSQL is required." }),
  requirement("r3", { type: "nice_to_have", skill: "kafka", text: "Kafka", quote: "Kafka is a plus." }),
  requirement("r4", { type: "responsibility", text: "Design REST APIs", quote: "Design REST APIs." }),
  requirement("r5", {
    type: "hard_eligibility",
    text: "2026 graduates",
    quote: "Graduates of 2026 only.",
    eligibility: hardRequirementSchema.parse({
      kind: "graduation_batch",
      quote: "Graduates of 2026 only.",
      value: { years: [2026] },
    }),
  }),
  requirement("r6", {
    type: "unclear",
    text: "Final-year students",
    quote: "Final-year students may apply.",
  }),
];

const prefs = (overrides: Partial<Preferences> = {}): Preferences => ({
  ...emptyPreferences(),
  desiredRoles: ["backend"],
  graduationYear: 2026,
  ...overrides,
});
const input = (overrides: Partial<MatchInput> = {}): MatchInput => ({
  profile: profile(),
  preferences: prefs(),
  experience: { paidMonths: 0, internshipMonths: 6 },
  job: {
    roleFamily: "backend",
    locations: ["Bengaluru"],
    remoteType: "onsite",
    employmentType: "full_time",
    salary: null,
  },
  requirements: REQUIREMENTS,
  similarity: 0.7,
  today: TODAY,
  ...overrides,
});

describe("profile evidence", () => {
  it("uses confirmed rows only and picks the strongest evidence", () => {
    const evidence = profileEvidence(profile());
    expect(evidence.map((item) => [item.ref, item.kind, item.heading])).toEqual([
      ["E1", "experience", "Backend Intern at Acme"],
      ["E2", "project", "Ledger"],
      ["E3", "skill", "Docker"],
    ]);
    expect(findSkillEvidence(evidence, "nodejs")).toEqual({
      tier: "internship",
      weight: 0.9,
      quote: "Built payment APIs in Node.js and Express",
      ref: "E1",
    });
    expect(findSkillEvidence(evidence, "postgresql")?.quote).toBe("Wrote PostgreSQL migrations for billing");
    expect(findSkillEvidence(evidence, "docker")).toMatchObject({ tier: "self_declared", quote: "Docker" });
    expect(findSkillEvidence(evidence, "kafka")).toBeNull();
  });

  it("compares experience and project text with responsibility quotes", () => {
    const texts = similarityTexts(profileEvidence(profile()), REQUIREMENTS);
    expect(texts.profile).toContain("Built payment APIs in Node.js and Express");
    expect(texts.profile).not.toContain("Docker");
    expect(texts.job).toBe("Must know Node.js.\nPostgreSQL is required.\nDesign REST APIs.");
  });
});

describe("match scoring", () => {
  it("bands by core-skill coverage and responsibility similarity", () => {
    const strong = scoreMatch(input());
    expect(strong.band).toBe("strong");
    expect(strong.coreCoverage).toBe(0.9);
    expect(strong.skills.find((skill) => skill.skill === "kafka")?.evidence).toBeNull();
    expect(strong.requirementChecks).toEqual([
      { requirementId: "r5", check: expect.objectContaining({ status: "met" }) },
    ]);
    expect(strong.unclear).toEqual([
      { requirementId: "r6", text: "Final-year students", quote: "Final-year students may apply." },
    ]);

    expect(scoreMatch(input({ similarity: 0.3 })).band).toBe("good");
    expect(scoreMatch(input({ similarity: null })).band).toBe("good");
  });

  it("drops a band as core skills go missing", () => {
    const missingPostgres = profile();
    missingPostgres.experiences[0] = {
      ...(missingPostgres.experiences[0] as ProfileContent["experiences"][number]),
      bullets: ["Built payment APIs in Node.js"],
      skills: ["Node.js"],
    };
    // Node.js from the internship (0.9) and nothing for PostgreSQL: 0.45 coverage.
    expect(scoreMatch(input({ profile: missingPostgres })).band).toBe("partial");
    expect(scoreMatch(input({ profile: emptyProfile() })).band).toBe("low");
  });

  it("excludes only on a known-failed hard requirement", () => {
    const excluded = scoreMatch(input({ preferences: prefs({ graduationYear: 2024 }) }));
    expect(excluded.band).toBe("excluded");

    const preferenceMismatch = scoreMatch(input({ preferences: prefs({ desiredRoles: ["frontend"] }) }));
    expect(preferenceMismatch.band).toBe("strong");
    expect(preferenceMismatch.preferenceChecks).toContainEqual(
      expect.objectContaining({ kind: "role", status: "unmet" }),
    );
    expect(preferenceMismatch.score).toBeLessThan(scoreMatch(input()).score);

    const unknownYear = scoreMatch(input({ preferences: prefs({ graduationYear: null }) }));
    expect(unknownYear.band).toBe("strong");
    expect(unknownYear.requirementChecks[0]?.check.status).toBe("check");
  });

  it("falls back to similarity when the job names no skills", () => {
    const responsibilities = REQUIREMENTS.filter((item) => item.type === "responsibility");
    expect(scoreMatch(input({ requirements: responsibilities })).band).toBe("good");
    expect(scoreMatch(input({ requirements: responsibilities, similarity: 0.2 })).band).toBe("partial");
    expect(scoreMatch(input({ requirements: [] })).coreCoverage).toBeNull();
  });

  it("computes cosine similarity defensively", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBeNull();
    expect(cosineSimilarity([0, 0], [1, 1])).toBeNull();
    expect(cosineSimilarity([], [])).toBeNull();
  });
});

describe("explanations", () => {
  const evidence = profileEvidence(profile());
  const context = { requirements: REQUIREMENTS, evidence, description: DESCRIPTION };
  const ref = (id: string) => requirementRef(REQUIREMENTS.findIndex((item) => item.id === id));

  it("keeps only items whose quotes are verbatim in their source", () => {
    const verified = verifyExplanation(
      {
        summary: "Solid backend fit.",
        strengths: [
          { requirement: ref("r1"), resumeQuote: "built payment APIs in node.js", note: "Shipped APIs." },
          { requirement: ref("r2"), resumeQuote: "Led a PostgreSQL team of ten", note: "Invented." },
          { requirement: "R99", resumeQuote: "Node.js", note: "Unknown requirement." },
          { requirement: ref("r5"), resumeQuote: "Node.js", note: "Eligibility is not a strength." },
        ],
        gaps: [{ requirement: ref("r3"), jobQuote: "Kafka is a plus.", note: "Try a Kafka side project." }],
        checks: [
          { requirement: ref("r6"), jobQuote: "Final-year students may apply.", note: "Ask about timing." },
          { requirement: ref("r6"), jobQuote: "Must be a final-year student", note: "Invented." },
        ],
      },
      context,
    );
    expect(verified.total).toBe(7);
    expect(verified.valid).toBe(4);
    expect(verified.strengths).toEqual([
      { requirementId: "r1", resumeQuote: "built payment APIs in node.js", note: "Shipped APIs." },
    ]);
    expect(verified.gapNotes.get("r3")).toBe("Try a Kafka side project.");
    expect(verified.checkNotes.get("r6")).toBe("Ask about timing.");
  });

  it("falls back to structured overlap with a prompt for every gap", () => {
    const match = scoreMatch(input());
    const explanation = buildExplanation(match, REQUIREMENTS, null, new Map([["r3", "does_not_have"]]));
    expect(explanation.source).toBe("structured");
    expect(explanation.summary).toBeNull();
    expect(explanation.quoteValidityRate).toBeNull();
    expect(explanation.strengths.map((item) => [item.requirement, item.tier])).toEqual([
      ["Node.js", "internship"],
      ["PostgreSQL", "internship"],
    ]);
    expect(explanation.gaps).toEqual([
      {
        requirementId: "r3",
        requirement: "Kafka",
        skill: "kafka",
        jobQuote: "Kafka is a plus.",
        core: false,
        note: null,
        response: "does_not_have",
      },
    ]);
    expect(explanation.checks).toEqual([
      {
        requirementId: "r6",
        requirement: "Final-year students",
        jobQuote: "Final-year students may apply.",
        note: null,
      },
    ]);
  });

  it("adds verified prose without overriding the deterministic overlap", () => {
    const match = scoreMatch(input());
    const verified = verifyExplanation(
      {
        summary: "Good fit.",
        strengths: [
          {
            requirement: ref("r4"),
            resumeQuote: "Built payment APIs in Node.js and Express",
            note: "Same work.",
          },
          { requirement: ref("r3"), resumeQuote: "Node.js", note: "Claims Kafka without evidence." },
        ],
        gaps: [{ requirement: ref("r3"), jobQuote: "Kafka is a plus.", note: "Learn Kafka basics." }],
        checks: [],
      },
      context,
    );
    const explanation = buildExplanation(match, REQUIREMENTS, verified);
    expect(explanation.source).toBe("model");
    expect(explanation.summary).toBe("Good fit.");
    expect(explanation.quoteValidityRate).toBe(1);
    expect(explanation.strengths.map((item) => item.requirementId)).toEqual(["r4", "r1", "r2"]);
    expect(explanation.strengths[0]).toMatchObject({ requirement: "Design REST APIs", note: "Same work." });
    expect(explanation.gaps.map((item) => [item.requirementId, item.note])).toEqual([
      ["r3", "Learn Kafka basics."],
    ]);
  });
});

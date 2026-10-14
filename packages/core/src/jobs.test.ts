import { describe, expect, it } from "vitest";
import {
  cleanJobText,
  type JobExtraction,
  jobExtractionSchema,
  jobTextSchema,
  jobUrlSchema,
  MIN_JOB_CHARACTERS,
  maskContactDetails,
  requirementLabel,
  verifyJobExtraction,
} from "./jobs";

const DESCRIPTION = cleanJobText(`
Backend Engineer (2026 batch) at Acme Payments

About the role
You will design and run REST APIs for our payments platform.

Requirements
- Strong experience with Node.js and PostgreSQL.
- Open to candidates graduating in 2025 or 2026.
- Must be based in Bengaluru.
- Familiarity with Kafka is a plus.
- Good communication skills.

Compensation: ₹8,00,000 - ₹12,00,000 per year.
`);

type RawRequirement = JobExtraction["requirements"][number];
const noDetails = {
  cities: null,
  relocationAccepted: null,
  country: null,
  sponsorshipAvailable: null,
  degreeLevels: null,
  degrees: null,
  fields: null,
  allowRelated: null,
  minScores: null,
  graduationYears: null,
  minYears: null,
  maxYears: null,
  joinWithinDays: null,
  startBy: null,
};
const req = (overrides: Partial<RawRequirement>): RawRequirement => ({
  type: "core_skill",
  text: "",
  quote: "",
  skill: null,
  eligibility: null,
  ...overrides,
});
const extraction = (overrides: Partial<JobExtraction> = {}): JobExtraction =>
  jobExtractionSchema.parse({
    title: "Backend Engineer",
    company: "Acme Payments",
    locations: ["Bengaluru"],
    remoteType: "onsite",
    employmentType: "full_time",
    seniority: "entry",
    roleFamily: "backend",
    salary: null,
    requirements: [],
    ...overrides,
  });

describe("job text input", () => {
  it("normalizes pasted text so quotes compare reliably", () => {
    expect(cleanJobText("  Node\u200B.js\u00A0 developer \r\n\r\n\r\n\r\nPune  ")).toBe(
      "Node.js developer\n\nPune",
    );
  });

  it("requires a full description", () => {
    expect(jobTextSchema.safeParse("Backend engineer, Node.js").success).toBe(false);
    expect(jobTextSchema.safeParse("x".repeat(MIN_JOB_CHARACTERS)).success).toBe(true);
    expect(jobTextSchema.safeParse(" \n".repeat(400)).success).toBe(false);
  });

  it("accepts only http and https links", () => {
    expect(jobUrlSchema.safeParse("https://jobs.example.com/123").success).toBe(true);
    expect(jobUrlSchema.safeParse("ftp://example.com/job").success).toBe(false);
    expect(jobUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(jobUrlSchema.safeParse("jobs.example.com").success).toBe(false);
  });

  it("masks recruiter emails and phone numbers but keeps years and salaries", () => {
    const masked = maskContactDetails(
      "Mail hr.team@acme.co.in or call +91 98765 43210. Batch 2024-2025. CTC ₹12,00,000.",
    );
    expect(masked).toBe("Mail [email removed] or call [phone removed]. Batch 2024-2025. CTC ₹12,00,000.");
  });
});

describe("job extraction verification", () => {
  it("keeps only requirements quoted verbatim and reports quote validity", () => {
    const result = verifyJobExtraction(
      extraction({
        requirements: [
          req({ text: "Node.js", quote: "Strong experience with Node.js and PostgreSQL.", skill: "NodeJS" }),
          req({
            text: "PostgreSQL",
            quote: "strong experience with node.js and postgresql",
            skill: "Postgres",
          }),
          req({ text: "Go", quote: "Strong experience with Go microservices.", skill: "Go" }),
          req({
            type: "nice_to_have",
            text: "Kafka",
            quote: "Familiarity with Kafka is a plus.",
            skill: "Kafka",
          }),
        ],
      }),
      DESCRIPTION,
    );
    expect(result.total).toBe(4);
    expect(result.valid).toBe(3);
    expect(result.validityRate).toBe(0.75);
    expect(result.job.requirements.map((item) => [item.type, item.skill])).toEqual([
      ["core_skill", "nodejs"],
      ["core_skill", "postgresql"],
      ["nice_to_have", "kafka"],
    ]);
  });

  it("turns a skill its quote doesn't name into a responsibility", () => {
    const { job } = verifyJobExtraction(
      extraction({
        requirements: [
          req({ text: "Communication", quote: "Good communication skills.", skill: "Java" }),
          req({ text: "APIs", quote: "design and run REST APIs", skill: null }),
        ],
      }),
      DESCRIPTION,
    );
    expect(job.requirements.map((item) => [item.type, item.skill])).toEqual([
      ["responsibility", null],
      ["responsibility", null],
    ]);
  });

  it("builds strict eligibility and downgrades malformed values to unclear", () => {
    const { job } = verifyJobExtraction(
      extraction({
        requirements: [
          req({
            type: "hard_eligibility",
            text: "2025 or 2026 graduates",
            quote: "Open to candidates graduating in 2025 or 2026.",
            eligibility: { ...noDetails, kind: "graduation_batch", graduationYears: [2025, 2026, 2026] },
          }),
          req({
            type: "hard_eligibility",
            text: "Based in Bengaluru",
            quote: "Must be based in Bengaluru.",
            eligibility: { ...noDetails, kind: "location", cities: [" "] },
          }),
          req({
            type: "hard_eligibility",
            text: "Bengaluru",
            quote: "Must be based in Bengaluru.",
            eligibility: null,
          }),
        ],
      }),
      DESCRIPTION,
    );
    expect(job.requirements).toHaveLength(2);
    expect(job.requirements[0]).toMatchObject({
      type: "hard_eligibility",
      eligibility: {
        kind: "graduation_batch",
        value: { years: [2025, 2026] },
        quote: "Open to candidates graduating in 2025 or 2026.",
      },
    });
    // The second and third are the same unclear requirement, so only one is kept.
    expect(job.requirements[1]).toMatchObject({ type: "unclear", eligibility: null });
  });

  it("keeps facts the text supports and falls back for the rest", () => {
    const { job } = verifyJobExtraction(
      extraction({
        title: "Senior Staff Engineer",
        company: "Acme Payments",
        locations: ["Bengaluru", "Mumbai", "Bengaluru"],
        salary: {
          min: 800000,
          max: 1200000,
          currency: "inr",
          period: "year",
          quote: "₹8,00,000 - ₹12,00,000",
        },
      }),
      DESCRIPTION,
    );
    expect(job.title).toBe("Untitled role");
    expect(job.company).toBe("Acme Payments");
    expect(job.locations).toEqual(["Bengaluru"]);
    expect(job.salary).toEqual({ min: 800000, max: 1200000, currency: "INR", period: "year" });

    const hinted = verifyJobExtraction(
      extraction({ salary: { min: 2000000, max: null, currency: "INR", period: "year", quote: "₹20 LPA" } }),
      DESCRIPTION,
      { title: "Backend Engineer II", company: "Acme" },
    );
    expect(hinted.job.title).toBe("Backend Engineer II");
    expect(hinted.job.company).toBe("Acme");
    expect(hinted.job.salary).toBeNull();
  });

  it("reports zero validity when the model found nothing", () => {
    expect(verifyJobExtraction(extraction(), DESCRIPTION).validityRate).toBe(0);
  });

  it("labels skills by name and other requirements by text", () => {
    expect(requirementLabel({ skill: "nodejs", text: "Node.js experience" })).toBe("Node.js");
    expect(requirementLabel({ skill: null, text: "Own the payments API" })).toBe("Own the payments API");
  });
});

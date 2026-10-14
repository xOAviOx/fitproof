import { describe, expect, it } from "vitest";
import {
  canonicalJobUrl,
  type DedupeKey,
  duplicateMatch,
  normalizeCompanyName,
  normalizeJobTitle,
  simhash,
  simhashSimilarity,
  textContainment,
} from "./dedupe";

const DESCRIPTION = [
  "We are hiring a backend engineer to build payment APIs in Node.js and PostgreSQL.",
  "You will design services, write tests, review code, and work with product managers.",
  "Requirements: 0-2 years of experience, strong JavaScript, SQL, and Git skills.",
  "Nice to have: Docker, AWS, and experience with message queues such as Kafka.",
].join("\n");

const leadingWords = (text: string, count: number) => text.split(/\s+/).slice(0, count).join(" ");

describe("normalizers", () => {
  it("groups company spellings without emptying short names", () => {
    expect(normalizeCompanyName("Freshworks Technologies Pvt. Ltd.")).toBe("freshworks");
    expect(normalizeCompanyName("Databricks, Inc.")).toBe("databricks");
    expect(normalizeCompanyName("Razorpay Software Private Limited")).toBe("razorpay software");
    expect(normalizeCompanyName("Company")).toBe("company");
  });

  it("drops place and work-mode words from titles", () => {
    expect(normalizeJobTitle("Software Engineer (Bengaluru, Hybrid)")).toBe("software engineer");
    expect(normalizeJobTitle("Software Engineer - Bangalore")).toBe("software engineer");
    expect(normalizeJobTitle("Sr. Data Analyst, Remote India")).toBe("senior data analyst");
    expect(normalizeJobTitle("Software Engineer II")).toBe("software engineer ii");
    expect(normalizeJobTitle("Pune")).toBe("pune");
  });

  it("canonicalizes posting URLs", () => {
    expect(canonicalJobUrl("https://jobs.lever.co/cred/abc-123/apply?lever-source=LinkedIn")).toBe(
      "https://jobs.lever.co/cred/abc-123",
    );
    expect(canonicalJobUrl("http://WWW.Example.com/careers/job?gh_jid=42&utm_source=x&gh_src=y#apply")).toBe(
      "https://example.com/careers/job?gh_jid=42",
    );
    expect(canonicalJobUrl("https://jobs.ashbyhq.com/notion/1fc3/application")).toBe(
      "https://jobs.ashbyhq.com/notion/1fc3",
    );
    expect(canonicalJobUrl("mailto:jobs@example.com")).toBeNull();
    expect(canonicalJobUrl("not a url")).toBeNull();
    expect(canonicalJobUrl(null)).toBeNull();
  });
});

describe("similarity", () => {
  it("SimHash is stable and close for near-identical text", () => {
    const a = simhash(DESCRIPTION);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(simhash(DESCRIPTION)).toBe(a);
    const edited = simhash(DESCRIPTION.replace("Kafka", "RabbitMQ"));
    expect(simhashSimilarity(a, edited)).toBeGreaterThan(0.8);
    expect(simhashSimilarity(a, simhash("A completely different posting for a chef in Paris."))).toBeLessThan(
      0.8,
    );
  });

  it("containment matches a snippet against its full description", () => {
    expect(textContainment(leadingWords(DESCRIPTION, 25), DESCRIPTION)).toBe(1);
    // Adzuna cuts snippets mid-word; one broken triple must not break the match.
    expect(textContainment(DESCRIPTION.slice(0, 160), DESCRIPTION)).toBeGreaterThan(0.9);
    expect(textContainment(DESCRIPTION, "Hiring a chef to run our kitchen in Paris.")).toBe(0);
    expect(textContainment("", DESCRIPTION)).toBe(0);
  });
});

describe("duplicateMatch", () => {
  const base: DedupeKey = {
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1",
    normalizedCompany: "acme",
    normalizedTitle: "backend engineer",
    locations: ["Bengaluru"],
    description: DESCRIPTION,
  };

  it("groups the same page, or the same role and place with the same description", () => {
    expect(duplicateMatch({ ...base, normalizedTitle: "other" }, base)).toEqual({
      similarity: 1,
      method: "apply_url",
    });
    expect(
      duplicateMatch(
        { ...base, canonicalUrl: "https://adzuna.in/x", description: leadingWords(DESCRIPTION, 40) },
        base,
      ),
    ).toEqual({ similarity: 1, method: "content" });
    expect(duplicateMatch({ ...base, canonicalUrl: null, locations: [] }, base)?.method).toBe("content");
  });

  it("keeps separate cities, titles, companies, and different descriptions apart", () => {
    const other = { ...base, canonicalUrl: null };
    expect(duplicateMatch({ ...other, locations: ["Pune"] }, base)).toBeNull();
    expect(duplicateMatch({ ...other, normalizedTitle: "frontend engineer" }, base)).toBeNull();
    expect(duplicateMatch({ ...other, normalizedCompany: "globex" }, base)).toBeNull();
    expect(
      duplicateMatch(
        { ...other, description: "Build dashboards in Tableau and write SQL for finance." },
        base,
      ),
    ).toBeNull();
  });
});

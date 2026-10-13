import { describe, expect, it } from "vitest";
import {
  allEvidenceConfirmed,
  emptyProfile,
  profileContentSchema,
  quoteExists,
  verifyExtractedProfile,
} from "./profile";

describe("profile boundaries", () => {
  it("does not mistake Go for Google or C for C++, and does not trust unsupported skill tiers", () => {
    const content = emptyProfile();
    content.skills = [
      { name: "Go", tier: "paid_work", sourceText: "Google, C++, SQL", userConfirmed: false },
      { name: "C", tier: "project", sourceText: "Google, C++, SQL", userConfirmed: false },
      { name: "SQL", tier: "paid_work", sourceText: "Google, C++, SQL", userConfirmed: false },
    ];
    const result = verifyExtractedProfile(content, "Google, C++, SQL");
    expect(result.content.skills).toEqual([
      { name: "SQL", tier: "self_declared", sourceText: "Google, C++, SQL", userConfirmed: false },
    ]);
  });
  it("checks quotes after case, unicode, and whitespace normalization", () => {
    expect(quoteExists("Built a REST\n API with Node.js", "built a rest API with node.js")).toBe(true);
    expect(quoteExists("Built an API", "")).toBe(false);
    expect(quoteExists("Built an API", "Built an AI model")).toBe(false);
  });
  it("drops invented entries and resets confirmation", () => {
    const content = emptyProfile();
    content.skills = [
      { name: "SQL", tier: "self_declared", sourceText: "Skills: SQL", userConfirmed: true },
      { name: "Rust", tier: "paid_work", sourceText: "Skills: SQL", userConfirmed: true },
    ];
    const result = verifyExtractedProfile(content, "Skills: SQL");
    expect(result.validityRate).toBe(0.5);
    expect(result.content.skills).toEqual([{ ...content.skills[0], userConfirmed: false }]);
    expect(allEvidenceConfirmed(result.content)).toBe(false);
  });
  it("rejects unsafe URLs and impossible dates and scores", () => {
    expect(
      profileContentSchema.safeParse({
        ...emptyProfile(),
        links: [{ label: "Site", url: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
    expect(
      profileContentSchema.safeParse({
        ...emptyProfile(),
        experiences: [
          {
            company: "Acme",
            title: "Intern",
            tier: "internship",
            location: null,
            startDate: "2026-06-01",
            endDate: "2026-01-01",
            isCurrent: false,
            bullets: [],
            skills: [],
            sourceText: null,
            userConfirmed: false,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      profileContentSchema.safeParse({
        ...emptyProfile(),
        education: [
          {
            institution: "Test University",
            degree: null,
            branch: null,
            startYear: null,
            graduationYear: null,
            scoreType: "cgpa",
            score: 11,
            scoreScale: 10,
            coursework: [],
            sourceText: null,
            userConfirmed: false,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

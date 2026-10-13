import { describe, expect, it } from "vitest";
import { redactResume } from "./privacy";

describe("résumé PII redaction", () => {
  it("keeps job titles while removing labelled single-word names", () => {
    const result = redactResume(
      "Name: Synthetic\nBackend Developer\nExperience\nBackend Developer at Example Labs\nSynthetic built an API",
    );
    expect(result.text).toContain("Backend Developer");
    expect(result.text).not.toContain("Synthetic");
  });
  it("removes header, contact lines, repeated names, emails, phones, URLs, and addresses", () => {
    const result = redactResume(`Synthetic Candidate
Backend Developer
synthetic@example.test | +91 9876543210
Address: 42 Example Road, Pune 411001
https://github.com/synthetic
Skills
TypeScript, PostgreSQL
Experience
Synthetic Candidate built a REST API with TypeScript.
Reach me at embedded@example.test or +91-98765-43210.
Portfolio https://example.test/profile
Address: 20 Other Lane 560001
Education
Example College, 2022 - 2026`);
    for (const pii of [
      "Synthetic Candidate",
      "example.test",
      "98765",
      "Example Road",
      "Other Lane",
      "411001",
      "560001",
    ]) {
      expect(result.text).not.toContain(pii);
    }
    expect(result.text).toContain("2022 - 2026");
    expect(result.text).toContain("TypeScript");
    expect(result.links).toContainEqual({ label: "GitHub", url: "https://github.com/synthetic" });
  });
  it("fails closed if there is no clear contact/section boundary", () => {
    expect(() => redactResume("A résumé with no headings or clear contact boundary")).toThrow(
      /safely separate/,
    );
  });
  it("supports uppercase and compound section headings", () => {
    expect(redactResume("Synthetic Person\nTECHNICAL SKILLS\nPython\nWORK EXPERIENCE\nSQL").text).toBe(
      "TECHNICAL SKILLS\nPython\nWORK EXPERIENCE\nSQL",
    );
  });
});

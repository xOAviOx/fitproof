import { describe, expect, it } from "vitest";
import { MAX_RESUME_BYTES, RESUME_MIME_TYPES, validateResumeFile, validateResumeText } from "./resume";

describe("résumé validation", () => {
  it("accepts PDF and DOCX, including uppercase extensions and absent browser MIME", () => {
    expect(validateResumeFile({ name: "resume.PDF", type: "", size: 100 }).mimeType).toBe(
      RESUME_MIME_TYPES.pdf,
    );
    expect(
      validateResumeFile({ name: "resume.docx", type: RESUME_MIME_TYPES.docx, size: 100 }).extension,
    ).toBe("docx");
  });
  it("rejects large, empty, mismatched, and unsupported files", () => {
    for (const file of [
      { name: "resume.pdf", type: "", size: MAX_RESUME_BYTES + 1 },
      { name: "resume.pdf", type: "", size: 0 },
      { name: "resume.pdf", type: "text/plain", size: 100 },
      { name: "resume.png", type: "image/png", size: 100 },
    ])
      expect(() => validateResumeFile(file)).toThrow();
  });
  it("gives an actionable scanned-document message and enforces input budget", () => {
    expect(() => validateResumeText("short")).toThrow(/scanned/);
    expect(() => validateResumeText("x".repeat(40_001))).toThrow(/too long/);
    expect(validateResumeText(" x".repeat(200))).toHaveLength(399);
  });
});

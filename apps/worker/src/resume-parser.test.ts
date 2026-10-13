import { RESUME_MIME_TYPES, redactResume, verifyExtractedProfile } from "@repo/core";
import { describe, expect, it } from "vitest";
import { checkResumeSignature, parseResume } from "./resume-parser";
import { fixtureDocx, fixturePdf, fixtureProfile } from "./testing/resume-fixtures";

describe("real file parsers with synthetic layouts", () => {
  it.each([
    ["single-column PDF", () => fixturePdf(), "pdf"],
    ["two-column PDF", () => fixturePdf(undefined, true), "pdf"],
    ["table-based DOCX", () => fixtureDocx(), "docx"],
  ] as const)("extracts readable, quote-verifiable text from %s", async (_name, make, extension) => {
    const text = await parseResume(make(), `resume.${extension}`, RESUME_MIME_TYPES[extension]);
    expect(text).toContain("TypeScript");
    expect(text).toContain("Example Institute");
    const stripped = redactResume(text);
    expect(stripped.text).not.toContain("synthetic@example.test");
    const result = verifyExtractedProfile(fixtureProfile(text), stripped.text);
    expect(result.validityRate).toBe(1);
    expect(result.content.experiences[0]?.tier).toBe("internship");
  });
  it("rejects disguised formats and too-short scanned output", async () => {
    await expect(
      parseResume(new Uint8Array(Buffer.from("not a PDF")), "fake.pdf", RESUME_MIME_TYPES.pdf),
    ).rejects.toThrow(/valid PDF/);
    await expect(
      parseResume(fixturePdf(["Scanned image"]), "scanned.pdf", RESUME_MIME_TYPES.pdf),
    ).rejects.toThrow(/scanned/);
  });
  it("rejects expanded DOCX limits before invoking mammoth", () => {
    const bytes = fixtureDocx();
    const buffer = Buffer.from(bytes);
    const offset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buffer.writeUInt32LE(30 * 1024 * 1024, offset + 24);
    expect(() => checkResumeSignature(buffer, "docx")).toThrow(/too much data/);
  });
});

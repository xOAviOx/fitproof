import { MAX_RESUME_BYTES, ResumeInputError, validateResumeFile, validateResumeText } from "@repo/core";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export function checkResumeSignature(bytes: Uint8Array, extension: "pdf" | "docx") {
  const buffer = Buffer.from(bytes);
  if (extension === "pdf" && buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new ResumeInputError("This file is not a valid PDF. Export your résumé again.");
  }
  if (extension === "docx") {
    if (buffer.readUInt32LE(0) !== 0x04034b50) {
      throw new ResumeInputError("This file is not a valid DOCX. Export your résumé again.");
    }
    let expanded = 0;
    let entries = 0;
    let documentFound = false;
    for (let offset = 0; offset + 46 <= buffer.length; offset++) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
      const filenameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const name = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString();
      if (name === "word/document.xml") documentFound = true;
      expanded += buffer.readUInt32LE(offset + 24);
      entries++;
      if (expanded > 20 * 1024 * 1024 || entries > 1000) {
        throw new ResumeInputError("This DOCX expands to too much data. Export a simpler résumé.");
      }
      offset += 45 + filenameLength + extraLength + commentLength;
    }
    if (!documentFound) throw new ResumeInputError("This ZIP file is not a DOCX résumé.");
  }
}

export async function parseResume(bytes: Uint8Array, filename: string, mimeType: string): Promise<string> {
  const { extension } = validateResumeFile({ name: filename, type: mimeType, size: bytes.length });
  if (bytes.length < 5 || bytes.length > MAX_RESUME_BYTES)
    throw new ResumeInputError("Invalid résumé file size.");
  checkResumeSignature(bytes, extension);
  try {
    if (extension === "docx") {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return validateResumeText(result.value);
    }
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      if (pdf.numPages > 30) throw new ResumeInputError("Upload a shorter résumé (at most 30 pages).");
      const result = await extractText(pdf, { mergePages: true });
      return validateResumeText(result.text);
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof ResumeInputError) throw error;
    throw new ResumeInputError(
      "We couldn't read this file. Remove password protection or export a fresh PDF/DOCX.",
    );
  }
}

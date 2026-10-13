export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const MIN_RESUME_CHARACTERS = 200;
export const MAX_RESUME_CHARACTERS = 40_000;
export const RESUME_MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;
export const RESUME_JOB_KIND = "resume.extract";

export class ResumeInputError extends Error {}

export function validateResumeFile(file: { name: string; type: string; size: number }): {
  extension: "pdf" | "docx";
  mimeType: string;
} {
  if (file.size === 0) throw new ResumeInputError("This file is empty. Choose a PDF or DOCX résumé.");
  if (file.size > MAX_RESUME_BYTES) throw new ResumeInputError("Choose a résumé smaller than 5 MB.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (
    (extension !== "pdf" && extension !== "docx") ||
    (file.type !== "" && file.type !== RESUME_MIME_TYPES[extension])
  ) {
    throw new ResumeInputError("Upload a PDF or DOCX file, not an image or another format.");
  }
  return { extension, mimeType: RESUME_MIME_TYPES[extension] };
}

export function validateResumeText(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < MIN_RESUME_CHARACTERS) {
    throw new ResumeInputError(
      "We couldn't read enough text. For a scanned résumé, export a text-based PDF or upload a DOCX.",
    );
  }
  if (trimmed.length > MAX_RESUME_CHARACTERS) {
    throw new ResumeInputError(
      "This résumé is too long to process. Upload a shorter version (about 10 pages).",
    );
  }
  return trimmed;
}

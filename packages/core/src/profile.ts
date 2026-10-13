import { z } from "zod";
import { EVIDENCE_TIERS, SCORE_TYPES } from "./vocab";

const text = z.string().trim().min(1).max(500);
const optionalText = z.string().trim().max(2000).nullable();
const list = z.array(text).max(40);
const date = z.iso.date().nullable();
const year = z.number().int().min(1950).max(2100).nullable();
const safeUrl = z
  .url()
  .max(2000)
  .refine((value) => ["https:", "http:"].includes(new URL(value).protocol), "Use an http or https URL");
const evidence = {
  id: z.uuid().optional(),
  sourceText: z.string().trim().min(1).max(8000).nullable(),
  userConfirmed: z.boolean(),
};

export const skillSchema = z.object({
  ...evidence,
  name: text,
  tier: z.enum(EVIDENCE_TIERS),
});
export const experienceSchema = z
  .object({
    ...evidence,
    tier: z.enum(["paid_work", "internship"]),
    company: text,
    title: text,
    location: optionalText,
    startDate: date,
    endDate: date,
    isCurrent: z.boolean(),
    bullets: list,
    skills: list,
  })
  .refine((row) => !row.startDate || !row.endDate || row.startDate <= row.endDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  })
  .refine((row) => !row.isCurrent || row.endDate === null, {
    message: "A current role cannot have an end date",
    path: ["endDate"],
  });
export const projectSchema = z.object({
  ...evidence,
  name: text,
  description: optionalText,
  url: safeUrl.nullable(),
  bullets: list,
  skills: list,
});
export const educationSchema = z
  .object({
    ...evidence,
    institution: text,
    degree: optionalText,
    branch: optionalText,
    startYear: year,
    graduationYear: year,
    scoreType: z.enum(SCORE_TYPES).nullable(),
    score: z.number().min(0).max(100).nullable(),
    scoreScale: z.number().positive().max(100).nullable(),
    coursework: list,
  })
  .refine((row) => !row.startYear || !row.graduationYear || row.startYear <= row.graduationYear, {
    message: "Graduation year must be after start year",
    path: ["graduationYear"],
  })
  .refine(
    (row) =>
      row.score === null ||
      (row.scoreType !== null &&
        row.scoreScale !== null &&
        row.score <= row.scoreScale &&
        (row.scoreType !== "percentage" || row.scoreScale === 100)),
    { message: "Provide a score type and valid scale (100 for percentage)", path: ["score"] },
  );
export const certificationSchema = z.object({
  ...evidence,
  name: text,
  issuer: optionalText,
  issuedOn: date,
  skills: list,
});

export const profileContentSchema = z.object({
  summary: optionalText,
  links: z.array(z.object({ label: text, url: safeUrl })).max(20),
  skills: z.array(skillSchema).max(100),
  experiences: z.array(experienceSchema).max(30),
  projects: z.array(projectSchema).max(30),
  education: z.array(educationSchema).max(15),
  certifications: z.array(certificationSchema).max(30),
});
export type ProfileContent = z.infer<typeof profileContentSchema>;
export const EVIDENCE_SECTIONS = [
  "skills",
  "experiences",
  "projects",
  "education",
  "certifications",
] as const;
export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number];

export const emptyProfile = (): ProfileContent => ({
  summary: null,
  links: [],
  skills: [],
  experiences: [],
  projects: [],
  education: [],
  certifications: [],
});

export function allEvidenceConfirmed(content: ProfileContent): boolean {
  return EVIDENCE_SECTIONS.every((section) => content[section].every((row) => row.userConfirmed));
}

export function hasEvidence(content: ProfileContent): boolean {
  return EVIDENCE_SECTIONS.some((section) => content[section].length > 0);
}

export function normalizeQuote(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

export function quoteExists(source: string, quote: string): boolean {
  const normalized = normalizeQuote(quote);
  return normalized.length > 0 && normalizeQuote(source).includes(normalized);
}

function termExists(source: string, term: string): boolean {
  const escaped = normalizeQuote(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    escaped.length > 0 &&
    new RegExp(`(?:^|[^\\p{L}\\p{N}_+#])${escaped}(?:$|[^\\p{L}\\p{N}_+#])`, "u").test(normalizeQuote(source))
  );
}

/** Only the extraction boundary calls this. Edited rows are not represented as résumé quotes. */
export function verifyExtractedProfile(content: ProfileContent, source: string) {
  let total = 0;
  let valid = 0;
  const verified = structuredClone(content);
  for (const section of EVIDENCE_SECTIONS) {
    const rows = verified[section];
    const accepted = rows.filter((row) => {
      total++;
      const identity =
        "company" in row ? [row.company, row.title] : "institution" in row ? [row.institution] : [row.name];
      const ok =
        row.sourceText !== null &&
        quoteExists(source, row.sourceText) &&
        identity.every((value) => termExists(row.sourceText ?? "", value));
      if (ok) valid++;
      row.userConfirmed = false;
      delete row.id;
      return ok;
    });
    // All section arrays retain their own element type; the runtime key is the same on both sides.
    Object.assign(verified, { [section]: accepted });
  }
  verified.links = [];
  verified.summary = content.summary && quoteExists(source, content.summary) ? content.summary : null;
  for (const experience of verified.experiences) {
    if (/\bintern(?:ship)?\b/i.test(experience.title)) experience.tier = "internship";
  }
  for (const section of ["experiences", "projects", "education", "certifications"] as const) {
    for (const row of verified[section]) {
      const quote = row.sourceText ?? "";
      if ("bullets" in row) row.bullets = row.bullets.filter((value) => quoteExists(quote, value));
      if ("skills" in row) row.skills = row.skills.filter((value) => termExists(quote, value));
      if ("coursework" in row) row.coursework = row.coursework.filter((value) => quoteExists(quote, value));
      if ("description" in row && row.description && !quoteExists(quote, row.description))
        row.description = null;
      if ("issuer" in row && row.issuer && !quoteExists(quote, row.issuer)) row.issuer = null;
      if ("degree" in row && row.degree && !quoteExists(quote, row.degree)) row.degree = null;
      if ("branch" in row && row.branch && !quoteExists(quote, row.branch)) row.branch = null;
      if ("location" in row && row.location && !quoteExists(quote, row.location)) row.location = null;
      if ("url" in row) row.url = null;
    }
  }
  for (const skill of verified.skills) {
    const work = verified.experiences
      .filter((row) => termExists(row.sourceText ?? "", skill.name))
      .sort((a, b) => Number(b.tier === "paid_work") - Number(a.tier === "paid_work"))[0];
    const project = verified.projects.find((row) => termExists(row.sourceText ?? "", skill.name));
    const course = [...verified.education, ...verified.certifications].find((row) =>
      termExists(row.sourceText ?? "", skill.name),
    );
    skill.tier =
      work?.tier ?? (project ? "project" : course ? "coursework_or_certification" : "self_declared");
    skill.sourceText = work?.sourceText ?? project?.sourceText ?? course?.sourceText ?? skill.sourceText;
  }
  return { content: verified, total, valid, validityRate: total === 0 ? 1 : valid / total };
}

export const EVIDENCE_LABELS: Record<(typeof EVIDENCE_TIERS)[number], string> = {
  paid_work: "Paid work",
  internship: "Internship",
  project: "Project",
  coursework_or_certification: "Coursework / certification",
  self_declared: "Self-declared",
};

import { z } from "zod";
import { type HardRequirement, hardRequirementSchema, type JobSalary } from "./eligibility";
import { quoteExists } from "./profile";
import { mentionsSkill, skillKey, skillLabel } from "./skills";
import {
  DEGREE_LEVELS,
  ELIGIBILITY_KINDS,
  EMPLOYMENT_TYPES,
  type EmploymentType,
  REMOTE_TYPES,
  REQUIREMENT_TYPES,
  type RemoteType,
  type RequirementType,
  ROLE_FAMILIES,
  type RoleFamily,
  SCORE_TYPES,
  SENIORITY_LEVELS,
  type SeniorityLevel,
} from "./vocab";

export const JOB_ANALYSIS_KIND = "job.analyze";
export const MIN_JOB_CHARACTERS = 200;
export const MAX_JOB_CHARACTERS = 30_000;

/** A problem with the job text itself. Retrying won't help, so the job fails with this message. */
export class JobInputError extends Error {}

const lengthMessage = `Paste the full job description, between ${MIN_JOB_CHARACTERS} and ${MAX_JOB_CHARACTERS.toLocaleString("en-IN")} characters.`;

export const jobTextSchema = z
  .string()
  .transform((text) => cleanJobText(text))
  .pipe(z.string().min(MIN_JOB_CHARACTERS, lengthMessage).max(MAX_JOB_CHARACTERS, lengthMessage));

export const jobUrlSchema = z
  .string()
  .trim()
  .max(2000, "That link is too long.")
  .pipe(z.url({ protocol: /^https?$/, message: "Enter a full link starting with https://" }));

/** Normalizes pasted text so quotes compare reliably: no zero-width characters, tidy blank lines. */
export function cleanJobText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00A0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{8,16}\d/g;

/** Recruiter emails and phone numbers are not needed for matching, so they never reach a provider. */
export function maskContactDetails(text: string): string {
  return text.replace(EMAIL, "[email removed]").replace(PHONE_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, "").length;
    return digits >= 10 && digits <= 13 ? "[phone removed]" : match;
  });
}

const looseText = z.string().max(2000);
const looseList = z.array(z.string().max(200)).max(20).nullable();

/**
 * Flat eligibility details. Providers' structured-output modes handle nullable fields more reliably
 * than nested unions, so the model fills the fields for its `kind` and code builds the strict value.
 */
const eligibilityDetailsSchema = z.object({
  kind: z.enum(ELIGIBILITY_KINDS),
  cities: looseList,
  relocationAccepted: z.boolean().nullable(),
  country: z.string().max(60).nullable(),
  sponsorshipAvailable: z.boolean().nullable(),
  degreeLevels: z.array(z.enum(DEGREE_LEVELS)).max(4).nullable(),
  degrees: looseList,
  fields: looseList,
  allowRelated: z.boolean().nullable(),
  minScores: z
    .array(z.object({ type: z.enum(SCORE_TYPES), value: z.number(), scale: z.number() }))
    .max(4)
    .nullable(),
  graduationYears: z.array(z.number()).max(10).nullable(),
  minYears: z.number().nullable(),
  maxYears: z.number().nullable(),
  joinWithinDays: z.number().nullable(),
  startBy: z.string().max(20).nullable(),
});
type EligibilityDetails = z.infer<typeof eligibilityDetailsSchema>;

/** What the model returns. Lenient on purpose: verification decides what is kept. */
export const jobExtractionSchema = z.object({
  title: z.string().max(300).nullable(),
  company: z.string().max(300).nullable(),
  locations: z.array(z.string().max(200)).max(20),
  remoteType: z.enum(REMOTE_TYPES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  seniority: z.enum(SENIORITY_LEVELS),
  roleFamily: z.enum(ROLE_FAMILIES).nullable(),
  salary: z
    .object({
      min: z.number().nullable(),
      max: z.number().nullable(),
      currency: z.string().max(10).nullable(),
      period: z.enum(["year", "month"]).nullable(),
      quote: looseText,
    })
    .nullable(),
  requirements: z
    .array(
      z.object({
        type: z.enum(REQUIREMENT_TYPES),
        text: z.string().max(400),
        quote: looseText,
        skill: z.string().max(120).nullable(),
        eligibility: eligibilityDetailsSchema.nullable(),
      }),
    )
    .max(80),
});
export type JobExtraction = z.infer<typeof jobExtractionSchema>;

export type ExtractedRequirement = {
  type: RequirementType;
  text: string;
  quote: string;
  /** Comparison key from `skillKey`, set only for core_skill and nice_to_have. */
  skill: string | null;
  eligibility: HardRequirement | null;
};
export type VerifiedJob = {
  title: string;
  company: string;
  locations: string[];
  remoteType: RemoteType;
  employmentType: EmploymentType;
  seniority: SeniorityLevel;
  roleFamily: RoleFamily | null;
  salary: JobSalary | null;
  requirements: ExtractedRequirement[];
};

const nonEmpty = (values: readonly string[] | null) =>
  (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);

function toHardRequirement(details: EligibilityDetails, quote: string): HardRequirement | null {
  const value = (() => {
    switch (details.kind) {
      case "location":
        return { cities: nonEmpty(details.cities), relocationAccepted: details.relocationAccepted ?? false };
      case "work_authorization":
        return {
          country: details.country?.trim().toUpperCase() ?? "",
          sponsorshipAvailable: details.sponsorshipAvailable,
        };
      case "degree":
        return {
          levels: details.degreeLevels ?? [],
          degrees: nonEmpty(details.degrees),
          fields: nonEmpty(details.fields),
          allowRelated: details.allowRelated ?? false,
          minScores: details.minScores ?? [],
        };
      case "graduation_batch":
        return { years: [...new Set(details.graduationYears ?? [])] };
      case "experience_band":
        return { minYears: details.minYears, maxYears: details.maxYears };
      case "availability":
        return { joinWithinDays: details.joinWithinDays, startBy: details.startBy };
    }
  })();
  const parsed = hardRequirementSchema.safeParse({ kind: details.kind, quote, value });
  return parsed.success ? parsed.data : null;
}

function inText(description: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && quoteExists(description, trimmed) ? trimmed : null;
}

/**
 * Keeps only what the job text supports. Every requirement needs a verbatim quote, skills must be
 * named in their quote, and malformed eligibility becomes `unclear` (a check, never an exclusion).
 * `validityRate` counts requirement quotes found in the text.
 */
export function verifyJobExtraction(
  raw: JobExtraction,
  description: string,
  hints: { title?: string | null; company?: string | null } = {},
) {
  let valid = 0;
  const seen = new Set<string>();
  const requirements: ExtractedRequirement[] = [];
  for (const item of raw.requirements) {
    const quote = item.quote.trim();
    if (!quote || !quoteExists(description, quote)) continue;
    valid++;
    let type = item.type;
    let skill: string | null = null;
    let eligibility: HardRequirement | null = null;
    if (type === "core_skill" || type === "nice_to_have") {
      const named = item.skill?.trim();
      const key = named ? skillKey(named) : "";
      if (named && key && (mentionsSkill(quote, key) || quoteExists(quote, named))) skill = key;
      else type = "responsibility";
    } else if (type === "hard_eligibility") {
      eligibility = item.eligibility ? toHardRequirement(item.eligibility, quote) : null;
      if (!eligibility) type = "unclear";
    }
    const text = item.text.trim() || quote;
    const identity = `${type}|${skill ?? ""}|${eligibility?.kind ?? ""}|${quote.toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    requirements.push({ type, text: text.slice(0, 300), quote: quote.slice(0, 1000), skill, eligibility });
  }
  const salaryQuote = raw.salary ? inText(description, raw.salary.quote) : null;
  const salary =
    raw.salary && salaryQuote && (raw.salary.min !== null || raw.salary.max !== null)
      ? {
          min: raw.salary.min === null ? null : Math.round(raw.salary.min),
          max: raw.salary.max === null ? null : Math.round(raw.salary.max),
          currency: raw.salary.currency?.trim().toUpperCase() || null,
          period: raw.salary.period,
        }
      : null;
  const job: VerifiedJob = {
    title: hints.title?.trim() || inText(description, raw.title) || "Untitled role",
    company: hints.company?.trim() || inText(description, raw.company) || "Company not stated",
    locations: [...new Set(raw.locations.map((place) => inText(description, place)).filter(isString))].slice(
      0,
      10,
    ),
    remoteType: raw.remoteType,
    employmentType: raw.employmentType,
    seniority: raw.seniority,
    roleFamily: raw.roleFamily,
    salary,
    requirements,
  };
  const total = raw.requirements.length;
  return { job, total, valid, validityRate: total === 0 ? 0 : valid / total };
}

const isString = (value: string | null): value is string => value !== null;

export const REQUIREMENT_TYPE_LABELS: Record<RequirementType, string> = {
  hard_eligibility: "Eligibility",
  core_skill: "Core skill",
  nice_to_have: "Nice to have",
  responsibility: "Responsibility",
  unclear: "Unclear",
};

export function requirementLabel(requirement: Pick<ExtractedRequirement, "skill" | "text">): string {
  return requirement.skill ? skillLabel(requirement.skill, requirement.text) : requirement.text;
}

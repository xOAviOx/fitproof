import { z } from "zod";
import { ROLE_FAMILY_LABELS } from "./product";
import { canonicalCity, degreeInfo, findFields, isRemoteWord } from "./terms";
import {
  type EmploymentType,
  REMOTE_PREFERENCES,
  type RemotePreference,
  type RemoteType,
  ROLE_FAMILIES,
  SCORE_TYPES,
  WORK_AUTHORIZATION_STATUSES,
  type WorkAuthorizationStatus,
} from "./vocab";

export const SELECTABLE_EMPLOYMENT_TYPES = [
  "full_time",
  "internship",
  "contract",
  "part_time",
] as const satisfies readonly EmploymentType[];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  internship: "Internship",
  contract: "Contract",
  part_time: "Part-time",
  unknown: "Not stated",
};

export const REMOTE_PREFERENCE_OPTIONS: Record<RemotePreference, { label: string; description: string }> = {
  remote: { label: "Remote only", description: "Office and hybrid jobs are filtered out." },
  hybrid: { label: "Hybrid or remote", description: "Office-only jobs are filtered out." },
  onsite: { label: "Office or hybrid", description: "Fully remote jobs are filtered out." },
  any: { label: "Open to anything", description: "Work mode never filters jobs." },
};

/** Which job work modes each preference accepts. */
export const ACCEPTED_WORK_MODES: Record<RemotePreference, readonly RemoteType[]> = {
  remote: ["remote"],
  hybrid: ["hybrid", "remote"],
  onsite: ["onsite", "hybrid"],
  any: ["onsite", "hybrid", "remote"],
};

export const WORK_AUTHORIZATION_LABELS: Record<WorkAuthorizationStatus, string> = {
  authorized: "Authorized to work in India (citizen, OCI, or valid permit)",
  needs_sponsorship: "Would need visa sponsorship to work in India",
};

export const CGPA_SCALES = [10, 5, 4] as const;
export const NOTICE_PERIOD_OPTIONS = [0, 15, 30, 45, 60, 90] as const;

export const preferencesFieldsSchema = z.object({
  desiredRoles: z.array(z.enum(ROLE_FAMILIES)).max(10),
  employmentTypes: z.array(z.enum(SELECTABLE_EMPLOYMENT_TYPES)).max(10),
  remotePreference: z.enum(REMOTE_PREFERENCES),
  locations: z
    .array(z.string().trim().min(1).max(60, "Keep each city under 60 characters."))
    .max(10, "Choose at most 10 cities."),
  willingToRelocate: z.boolean().nullable(),
  minAnnualSalaryInr: z
    .number("Enter a number.")
    .int()
    .min(50_000, "Enter at least ₹0.5 LPA, or leave this empty.")
    .max(50_000_000, "Enter at most ₹500 LPA.")
    .nullable(),
  noticePeriodDays: z.number().int().min(0).max(180, "Enter at most 180 days.").nullable(),
  availableFrom: z.iso.date("Enter a valid date.").nullable(),
  graduationYear: z
    .number("Enter a year.")
    .int("Enter a year.")
    .min(1970, "Enter a year after 1970.")
    .max(2100, "Enter a valid year.")
    .nullable(),
  degree: z.string().trim().min(1).max(120).nullable(),
  branch: z.string().trim().min(1).max(120).nullable(),
  scoreType: z.enum(SCORE_TYPES).nullable(),
  score: z.number("Enter a number.").min(0).max(100, "Enter at most 100.").nullable(),
  scoreScale: z.number().positive().max(100).nullable(),
  workAuthorization: z.enum(WORK_AUTHORIZATION_STATUSES).nullable(),
});
export type Preferences = z.infer<typeof preferencesFieldsSchema>;
export type PreferenceField = keyof Preferences;

/** Use for user input. Stored rows are read with the lenient `preferencesFieldsSchema`. */
export const preferencesSchema = preferencesFieldsSchema.superRefine((value, context) => {
  if (!value.desiredRoles.length) {
    context.addIssue({ code: "custom", path: ["desiredRoles"], message: "Choose at least one role." });
  }
  if (!value.employmentTypes.length) {
    context.addIssue({ code: "custom", path: ["employmentTypes"], message: "Choose at least one job type." });
  }
  if (value.remotePreference !== "remote" && value.locations.every(isRemoteWord)) {
    context.addIssue({
      code: "custom",
      path: ["locations"],
      message: "Choose at least one city, or choose remote only.",
    });
  }
  if (value.score === null) return;
  if (value.scoreType === null) {
    context.addIssue({ code: "custom", path: ["scoreType"], message: "Choose CGPA or percentage." });
    return;
  }
  const scale = value.scoreType === "percentage" ? 100 : value.scoreScale;
  if (value.scoreType === "cgpa" && !CGPA_SCALES.some((option) => option === scale)) {
    context.addIssue({ code: "custom", path: ["scoreScale"], message: "Choose a CGPA scale." });
    return;
  }
  if (scale !== null && value.score > scale) {
    context.addIssue({ code: "custom", path: ["score"], message: `Enter a score up to ${scale}.` });
  }
});

/** First message per top-level field, for inline form errors on the client and server. */
export function preferenceErrors(value: unknown): Partial<Record<PreferenceField, string>> {
  const result = preferencesSchema.safeParse(value);
  if (result.success) return {};
  const errors: Partial<Record<PreferenceField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in preferencesFieldsSchema.shape) {
      errors[field as PreferenceField] ??= issue.message;
    }
  }
  return errors;
}

export const emptyPreferences = (): Preferences => ({
  desiredRoles: [],
  employmentTypes: [],
  remotePreference: "any",
  locations: [],
  willingToRelocate: null,
  minAnnualSalaryInr: null,
  noticePeriodDays: null,
  availableFrom: null,
  graduationYear: null,
  degree: null,
  branch: null,
  scoreType: null,
  score: null,
  scoreScale: null,
  workAuthorization: null,
});

/** Canonicalizes city names, removes duplicates, and clears partial score data. Idempotent. */
export function normalizePreferences(input: Preferences): Preferences {
  const seen = new Set<string>();
  const locations: string[] = [];
  for (const raw of input.locations) {
    const name = canonicalCity(raw) ?? raw.trim().replace(/\s+/g, " ");
    const key = name.toLocaleLowerCase("en");
    if (!name || isRemoteWord(name) || seen.has(key)) continue;
    seen.add(key);
    locations.push(name);
  }
  const hasScore = input.score !== null && input.scoreType !== null;
  return {
    ...input,
    desiredRoles: ROLE_FAMILIES.filter((role) => input.desiredRoles.includes(role)),
    employmentTypes: SELECTABLE_EMPLOYMENT_TYPES.filter((type) => input.employmentTypes.includes(type)),
    locations,
    degree: input.degree?.trim() || null,
    branch: input.branch?.trim() || null,
    score: hasScore ? input.score : null,
    scoreType: hasScore ? input.scoreType : null,
    scoreScale: hasScore ? (input.scoreType === "percentage" ? 100 : input.scoreScale) : null,
  };
}

export function formatLpa(inr: number): string {
  return `₹${Number((inr / 100_000).toFixed(2))} LPA`;
}

/** Today's date in India, where the product's users are, as an ISO date. */
export const indiaToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatList(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 2) return items.join(` ${conjunction} `);
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items.at(-1)}`;
}

export function formatScore(score: number, type: "cgpa" | "percentage", scale: number | null): string {
  return type === "percentage" ? `${score}%` : `${score}/${scale ?? 10} CGPA`;
}

export function formatMonths(months: number): string {
  if (months === 0) return "no paid work experience";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} of paid work`;
  const years = Number((months / 12).toFixed(1));
  return `${years} year${years === 1 ? "" : "s"} of paid work`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** `null` means some entry is undated, so the total is unknown. */
export type ExperienceSummary = { paidMonths: number | null; internshipMonths: number | null };

export type FilterRule = {
  id: string;
  label: string;
  value: string;
  effect: string;
  /** `filter` narrows search results; `eligibility` is compared with job requirements; `missing` means checks. */
  kind: "filter" | "eligibility" | "missing";
};

/** Plain-language description of how saved preferences affect results. Shared by the UI and tests. */
export function describeFilters(input: Preferences, experience: ExperienceSummary | null): FilterRule[] {
  const p = normalizePreferences(input);
  const rules: FilterRule[] = [];
  const cities = formatList(p.locations, "or");
  rules.push({
    id: "roles",
    label: "Roles",
    value: p.desiredRoles.length
      ? formatList(p.desiredRoles.map((role) => ROLE_FAMILY_LABELS[role]))
      : "Not set",
    effect: p.desiredRoles.length
      ? "Jobs in other role families are filtered out."
      : "Choose at least one role.",
    kind: p.desiredRoles.length ? "filter" : "missing",
  });
  const unselected = SELECTABLE_EMPLOYMENT_TYPES.filter((type) => !p.employmentTypes.includes(type));
  rules.push({
    id: "employmentTypes",
    label: "Job types",
    value: p.employmentTypes.length
      ? formatList(p.employmentTypes.map((type) => EMPLOYMENT_TYPE_LABELS[type]))
      : "Not set",
    effect: !p.employmentTypes.length
      ? "Choose at least one job type."
      : unselected.length
        ? `${formatList(unselected.map((type) => EMPLOYMENT_TYPE_LABELS[type].toLowerCase()))} roles are filtered out. Postings that don't state a type show a check.`
        : "Job type never filters jobs.",
    kind: p.employmentTypes.length ? "filter" : "missing",
  });
  rules.push({
    id: "remotePreference",
    label: "Work mode",
    value: REMOTE_PREFERENCE_OPTIONS[p.remotePreference].label,
    effect: REMOTE_PREFERENCE_OPTIONS[p.remotePreference].description,
    kind: "filter",
  });
  if (p.remotePreference !== "remote") {
    rules.push({
      id: "locations",
      label: "Cities",
      value: p.locations.length ? formatList(p.locations) : "Not set",
      effect: !p.locations.length
        ? "Choose at least one city."
        : p.willingToRelocate === true
          ? "Office and hybrid jobs in other cities still appear, because you're open to relocating."
          : p.willingToRelocate === false
            ? `Office and hybrid jobs outside ${cities} are filtered out.`
            : `Office and hybrid jobs outside ${cities} show a check until you say whether you'd relocate.`,
      kind: p.locations.length ? (p.willingToRelocate === null ? "missing" : "filter") : "missing",
    });
  }
  rules.push({
    id: "minAnnualSalaryInr",
    label: "Minimum salary",
    value: p.minAnnualSalaryInr === null ? "Not set" : `At least ${formatLpa(p.minAnnualSalaryInr)}`,
    effect:
      p.minAnnualSalaryInr === null
        ? "Pay never filters jobs."
        : "Jobs that publish lower annual pay in INR are filtered out. Unpublished pay and internship stipends never filter.",
    kind: "filter",
  });
  const availability = [
    p.noticePeriodDays === null
      ? null
      : p.noticePeriodDays === 0
        ? "available immediately"
        : `${p.noticePeriodDays}-day notice period`,
    p.availableFrom === null ? null : `available from ${formatDate(p.availableFrom)}`,
  ].filter((part): part is string => part !== null);
  rules.push({
    id: "availability",
    label: "Availability",
    value: availability.length ? capitalize(availability.join(", ")) : "Not set",
    effect: availability.length
      ? "Compared with joining deadlines stated in job descriptions."
      : "Jobs with a joining deadline show a check.",
    kind: availability.length ? "eligibility" : "missing",
  });
  rules.push({
    id: "graduationYear",
    label: "Graduation year",
    value: p.graduationYear === null ? "Not set" : String(p.graduationYear),
    effect:
      p.graduationYear === null
        ? "Jobs that ask for a graduation batch show a check."
        : "Compared with graduation batch requirements.",
    kind: p.graduationYear === null ? "missing" : "eligibility",
  });
  const degree = degreeInfo(p.degree);
  const branchKnown = p.branch !== null && findFields(p.branch).length > 0;
  rules.push({
    id: "degree",
    label: "Degree and branch",
    value: [p.degree, p.branch].filter(Boolean).join(", ") || "Not set",
    effect:
      p.degree === null || p.branch === null
        ? "Jobs with degree or branch requirements show a check for the missing part."
        : degree.level === null || !branchKnown
          ? "Compared with degree requirements. Anything we can't recognize shows a check, never an exclusion."
          : "Compared with degree and branch requirements.",
    kind: p.degree === null || p.branch === null ? "missing" : "eligibility",
  });
  rules.push({
    id: "score",
    label: "Academic score",
    value:
      p.score === null || p.scoreType === null ? "Not set" : formatScore(p.score, p.scoreType, p.scoreScale),
    effect:
      p.score === null
        ? "Jobs with a CGPA or percentage cutoff show a check."
        : "Compared with cutoffs on the same scale. Other scales show a check, because conversions vary by university.",
    kind: p.score === null ? "missing" : "eligibility",
  });
  rules.push({
    id: "workAuthorization",
    label: "Work authorization",
    value: p.workAuthorization === null ? "Not set" : WORK_AUTHORIZATION_LABELS[p.workAuthorization],
    effect:
      p.workAuthorization === null
        ? "Jobs that state work authorization requirements show a check."
        : "Compared with work authorization requirements for India. Other countries show a check.",
    kind: p.workAuthorization === null ? "missing" : "eligibility",
  });
  const paid = experience?.paidMonths ?? null;
  rules.push({
    id: "experience",
    label: "Experience",
    value: paid === null ? "Unknown" : capitalize(formatMonths(paid)),
    effect:
      paid === null
        ? "From your confirmed profile. Confirm your profile with dated work entries; until then, experience requirements show a check."
        : "From your confirmed profile's dated paid work. Edit your profile to change it.",
    kind: paid === null ? "missing" : "eligibility",
  });
  return rules;
}

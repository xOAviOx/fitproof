import { z } from "zod";
import { SCORING_CONFIG } from "./config/scoring";
import {
  ACCEPTED_WORK_MODES,
  EMPLOYMENT_TYPE_LABELS,
  type ExperienceSummary,
  formatDate,
  formatList,
  formatLpa,
  formatMonths,
  formatScore,
  normalizePreferences,
  type Preferences,
  REMOTE_PREFERENCE_OPTIONS,
  SELECTABLE_EMPLOYMENT_TYPES,
} from "./preferences";
import { ROLE_FAMILY_LABELS } from "./product";
import type { ProfileContent } from "./profile";
import {
  canonicalCity,
  compareDegreeLevels,
  DEGREE_LEVEL_LABELS,
  degreeInfo,
  findCities,
  findFields,
  normalizeTerm,
} from "./terms";
import {
  DEGREE_LEVELS,
  type EligibilityKind,
  type EmploymentType,
  type RemoteType,
  type RoleFamily,
  SCORE_TYPES,
} from "./vocab";

const quote = z.string().trim().min(1).max(2000);
const place = z.string().trim().min(1).max(80);
const scoreThresholdSchema = z
  .object({
    type: z.enum(SCORE_TYPES),
    value: z.number().positive().max(100),
    scale: z.number().positive().max(100),
  })
  .refine((t) => t.value <= t.scale && (t.type !== "percentage" || t.scale === 100), "Invalid score cutoff");

/**
 * Structured `hard_eligibility` requirements. `quote` is the verbatim job-description sentence.
 * Stored as `job_requirements.eligibility_kind` + `eligibility_value` + `quote`.
 */
export const hardRequirementSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("location"),
    quote,
    value: z.object({ cities: z.array(place).min(1).max(20), relocationAccepted: z.boolean() }),
  }),
  z.object({
    kind: z.literal("work_authorization"),
    quote,
    value: z.object({
      country: z.string().regex(/^[A-Z]{2}$/, "Use an ISO 3166 alpha-2 country code"),
      sponsorshipAvailable: z.boolean().nullable(),
    }),
  }),
  z.object({
    kind: z.literal("degree"),
    quote,
    value: z
      .object({
        levels: z.array(z.enum(DEGREE_LEVELS)).max(DEGREE_LEVELS.length),
        degrees: z.array(place).max(12),
        fields: z.array(place).max(12),
        allowRelated: z.boolean(),
        minScores: z.array(scoreThresholdSchema).max(4),
      })
      .refine(
        (v) => v.levels.length + v.degrees.length + v.fields.length + v.minScores.length > 0,
        "A degree requirement needs at least one condition",
      ),
  }),
  z.object({
    kind: z.literal("graduation_batch"),
    quote,
    value: z.object({ years: z.array(z.number().int().min(1970).max(2100)).min(1).max(10) }),
  }),
  z.object({
    kind: z.literal("experience_band"),
    quote,
    value: z
      .object({
        minYears: z.number().min(0).max(40).nullable(),
        maxYears: z.number().min(0).max(40).nullable(),
      })
      .refine(
        (v) =>
          (v.minYears !== null || v.maxYears !== null) &&
          (v.minYears === null || v.maxYears === null || v.minYears <= v.maxYears),
        "Give a minimum, a maximum, or an ordered range",
      ),
  }),
  z.object({
    kind: z.literal("availability"),
    quote,
    value: z
      .object({
        joinWithinDays: z.number().int().min(0).max(365).nullable(),
        startBy: z.iso.date().nullable(),
      })
      .refine((v) => v.joinWithinDays !== null || v.startBy !== null, "Give a deadline"),
  }),
]);
export type HardRequirement = z.infer<typeof hardRequirementSchema>;
type RequirementValue<K extends EligibilityKind> = Extract<HardRequirement, { kind: K }>["value"];

/** Maps a stored `job_requirements` row. Returns null for invalid values, which callers show as unclear. */
export function parseHardRequirement(row: {
  eligibilityKind: EligibilityKind | null;
  eligibilityValue: unknown;
  quote: string;
}): HardRequirement | null {
  const parsed = hardRequirementSchema.safeParse({
    kind: row.eligibilityKind,
    value: row.eligibilityValue,
    quote: row.quote,
  });
  return parsed.success ? parsed.data : null;
}

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS;
const addDays = (isoDate: string, days: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function totalMonths(entries: ProfileContent["experiences"], today: string): number | null {
  const intervals: [number, number][] = [];
  const now = dayNumber(today);
  for (const entry of entries) {
    const end = entry.isCurrent ? today : entry.endDate;
    if (!entry.startDate || !end) return null;
    const start = dayNumber(entry.startDate);
    const stop = Math.min(dayNumber(end) + 1, now + 1);
    if (stop > start) intervals.push([start, stop]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let days = 0;
  let open: [number, number] | null = null;
  for (const [start, stop] of intervals) {
    if (open && start <= open[1]) {
      open[1] = Math.max(open[1], stop);
    } else {
      if (open) days += open[1] - open[0];
      open = [start, stop];
    }
  }
  if (open) days += open[1] - open[0];
  return Math.round(days / (365.25 / 12));
}

/** Overlapping entries count once. Any undated entry makes that total unknown. */
export function summarizeExperience(content: ProfileContent, today: string): ExperienceSummary {
  return {
    paidMonths: totalMonths(
      content.experiences.filter((entry) => entry.tier === "paid_work"),
      today,
    ),
    internshipMonths: totalMonths(
      content.experiences.filter((entry) => entry.tier === "internship"),
      today,
    ),
  };
}

export type JobSalary = {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: string | null;
};
export type JobFacts = {
  roleFamily: RoleFamily | null;
  locations: readonly string[];
  remoteType: RemoteType;
  employmentType: EmploymentType;
  salary: JobSalary | null;
  requirements: readonly HardRequirement[];
};
/** Pass `experience: null` unless the profile is confirmed; unconfirmed evidence is never matched. */
export type CandidateFacts = { preferences: Preferences | null; experience: ExperienceSummary | null };

export const FIT_CHECK_STATUSES = ["met", "unmet", "check"] as const;
export type FitCheckStatus = (typeof FIT_CHECK_STATUSES)[number];
export type PreferenceFilterKind = "role" | "work_mode" | "location" | "employment_type" | "salary";
export type FitCheck =
  | { source: "preference"; kind: PreferenceFilterKind; status: FitCheckStatus; message: string }
  | { source: "requirement"; kind: EligibilityKind; status: FitCheckStatus; message: string; quote: string };
/** `excluded` only when something is known to fail; unknowns produce `check`. */
export type EligibilityOutcome = "eligible" | "check" | "excluded";
export type EligibilityResult = { outcome: EligibilityOutcome; checks: FitCheck[] };

type Verdict = { status: FitCheckStatus; message: string };
const met = (message: string): Verdict => ({ status: "met", message });
const unmet = (message: string): Verdict => ({ status: "unmet", message });
const check = (message: string): Verdict => ({ status: "check", message });

const WORK_MODE_LABELS: Record<RemoteType, string> = {
  onsite: "office-based",
  hybrid: "hybrid",
  remote: "fully remote",
  unknown: "not stated",
};

function placeMatches(userPlaces: readonly string[], jobPlace: string): boolean {
  const jobCities = findCities(jobPlace);
  const jobText = ` ${normalizeTerm(jobPlace)} `;
  return userPlaces.some((userPlace) => {
    const city = canonicalCity(userPlace);
    return city ? jobCities.includes(city) : jobText.includes(` ${normalizeTerm(userPlace)} `);
  });
}

function assessPlaces(userPlaces: readonly string[], places: readonly string[]) {
  return {
    matched: places.find((jobPlace) => placeMatches(userPlaces, jobPlace)) ?? null,
    allRecognized: places.every((jobPlace) => findCities(jobPlace).length > 0),
  };
}

function roleFilter(p: Preferences, job: JobFacts): Verdict | null {
  if (!p.desiredRoles.length) return null;
  if (job.roleFamily === null) return check("We couldn't tell which role family this job belongs to.");
  const label = ROLE_FAMILY_LABELS[job.roleFamily];
  if (p.desiredRoles.includes(job.roleFamily)) return met(`${label} is one of your target roles.`);
  const wanted = formatList(
    p.desiredRoles.map((role) => ROLE_FAMILY_LABELS[role]),
    "or",
  );
  return unmet(`This is a ${label} role. You're looking for ${wanted}.`);
}

function workModeFilter(p: Preferences, job: JobFacts): Verdict | null {
  if (p.remotePreference === "any") return null;
  const preference = REMOTE_PREFERENCE_OPTIONS[p.remotePreference].label;
  if (job.remoteType === "unknown") {
    return check(
      `The posting doesn't say whether it's remote, hybrid, or office-based. You chose “${preference}”.`,
    );
  }
  const mode = WORK_MODE_LABELS[job.remoteType];
  return ACCEPTED_WORK_MODES[p.remotePreference].includes(job.remoteType)
    ? met(`This job is ${mode}, which fits “${preference}”.`)
    : unmet(`This job is ${mode}. You chose “${preference}”.`);
}

function locationFilter(p: Preferences, job: JobFacts): Verdict | null {
  if (job.remoteType === "remote" || p.remotePreference === "remote") return null;
  if (!job.locations.length) return check("The posting doesn't list a location.");
  const where = formatList([...job.locations], "or");
  const { matched, allRecognized } = assessPlaces(p.locations, job.locations);
  if (matched) return met(`${matched} is one of your cities.`);
  if (p.willingToRelocate === true) return met(`This job is in ${where}. You're open to relocating.`);
  if (!p.locations.length) return check(`This job is in ${where}. Add your preferred cities to check this.`);
  if (!allRecognized)
    return check(`We couldn't recognize the location “${where}”. Check it before applying.`);
  if (p.willingToRelocate === null) {
    return check(`This job is in ${where}, outside your cities. Tell us whether you'd relocate.`);
  }
  return unmet(
    `This job is in ${where}. You chose ${formatList(p.locations)} and aren't open to relocating.`,
  );
}

function employmentFilter(p: Preferences, job: JobFacts): Verdict | null {
  if (!p.employmentTypes.length || p.employmentTypes.length === SELECTABLE_EMPLOYMENT_TYPES.length)
    return null;
  const chosen = formatList(p.employmentTypes.map((type) => EMPLOYMENT_TYPE_LABELS[type].toLowerCase()));
  if (job.employmentType === "unknown")
    return check(`The posting doesn't state the job type. You chose ${chosen}.`);
  const label = EMPLOYMENT_TYPE_LABELS[job.employmentType];
  return (p.employmentTypes as readonly EmploymentType[]).includes(job.employmentType)
    ? met(`${label} is one of your job types.`)
    : unmet(`Job type is ${label.toLowerCase()}. You chose ${chosen}.`);
}

const PERIOD_MULTIPLIERS: Record<string, number> = {
  year: 1,
  yearly: 1,
  annual: 1,
  annually: 1,
  annum: 1,
  "per year": 1,
  "per annum": 1,
  month: 12,
  monthly: 12,
  "per month": 12,
};

function salaryFilter(p: Preferences, job: JobFacts): Verdict | null {
  const minimum = p.minAnnualSalaryInr;
  const salary = job.salary;
  // Stipends are not comparable with an annual salary expectation; missing currency or period is unknown.
  if (minimum === null || !salary || job.employmentType === "internship") return null;
  const multiplier = PERIOD_MULTIPLIERS[normalizeTerm(salary.period ?? "")];
  if (salary.currency?.trim().toUpperCase() !== "INR" || multiplier === undefined) return null;
  const yours = formatLpa(minimum);
  if (salary.max !== null) {
    const top = salary.max * multiplier;
    return top >= minimum
      ? met(`Published pay goes up to ${formatLpa(top)}, meeting your minimum of ${yours}.`)
      : unmet(`Published pay is up to ${formatLpa(top)}, below your minimum of ${yours}.`);
  }
  if (salary.min === null) return null;
  const floor = salary.min * multiplier;
  return floor >= minimum
    ? met(`Published pay starts at ${formatLpa(floor)}, meeting your minimum of ${yours}.`)
    : check(
        `Published pay starts at ${formatLpa(floor)}, and no maximum is listed. Your minimum is ${yours}.`,
      );
}

function combine(verdicts: Verdict[]): Verdict {
  for (const status of ["unmet", "check"] as const) {
    const matching = verdicts.filter((verdict) => verdict.status === status);
    if (matching.length) return { status, message: matching.map((verdict) => verdict.message).join(" ") };
  }
  return met(verdicts.map((verdict) => verdict.message).join(" "));
}

function degreeVerdict(v: RequirementValue<"degree">, p: Preferences): Verdict {
  const asked = v.degrees.length
    ? `${formatList(v.degrees, "or")}${v.allowRelated ? " or equivalent" : ""}`
    : `a ${formatList(
        v.levels.map((level) => DEGREE_LEVEL_LABELS[level]),
        "or",
      )} degree`;
  if (p.degree === null) return check(`Asks for ${asked}. Add your degree to check this.`);
  const user = degreeInfo(p.degree);
  if (user.level === null) {
    return check(`Asks for ${asked}. We couldn't recognize “${p.degree}”, so check this before applying.`);
  }
  const required = v.degrees.map(degreeInfo);
  if (v.levels.includes(user.level) || required.some((r) => r.keys.some((key) => user.keys.includes(key)))) {
    return met(`Your ${p.degree} meets the degree requirement.`);
  }
  const everyRecognized = required.every((r) => r.level !== null && r.keys.length > 0);
  const accepted = [...v.levels, ...required.flatMap((r) => (r.level ? [r.level] : []))].sort(
    compareDegreeLevels,
  );
  const lowest = accepted[0];
  const highest = accepted.at(-1);
  if (lowest && everyRecognized && compareDegreeLevels(user.level, lowest) < 0) {
    return unmet(
      `Asks for ${asked}. Your ${p.degree} is a ${DEGREE_LEVEL_LABELS[user.level]} qualification.`,
    );
  }
  if (highest && compareDegreeLevels(user.level, highest) > 0) {
    return check(`Asks for ${asked}. You have a higher degree (${p.degree}); confirm it's accepted.`);
  }
  if (!v.levels.length && !v.allowRelated && everyRecognized && user.keys.length > 0) {
    return unmet(`Asks for ${asked}. Your degree is ${p.degree}.`);
  }
  return check(`Asks for ${asked}. Confirm your ${p.degree} is accepted.`);
}

function fieldVerdict(v: RequirementValue<"degree">, p: Preferences): Verdict {
  const asked = `${formatList(v.fields, "or")}${v.allowRelated ? " or a related field" : ""}`;
  if (p.branch === null) return check(`Asks for ${asked}. Add your branch or major to check this.`);
  const user = findFields(p.branch);
  const required = v.fields.map(findFields);
  if (required.some((keys) => keys.some((key) => user.includes(key)))) {
    return met(`Your branch (${p.branch}) matches.`);
  }
  if (!user.length || v.allowRelated || required.some((keys) => !keys.length)) {
    return check(`Asks for ${asked}. Confirm your branch (${p.branch}) is accepted.`);
  }
  return unmet(`Asks for ${asked}. Your branch is ${p.branch}.`);
}

function scoreVerdict(thresholds: RequirementValue<"degree">["minScores"], p: Preferences): Verdict {
  const asked = formatList(
    thresholds.map((t) => formatScore(t.value, t.type, t.scale)),
    "or",
  );
  if (p.score === null || p.scoreType === null) {
    return check(`Asks for at least ${asked}. Add your CGPA or percentage to check this.`);
  }
  const score = p.score;
  const scale = p.scoreType === "percentage" ? 100 : p.scoreScale;
  const yours = formatScore(score, p.scoreType, scale);
  const comparable = thresholds.filter((t) => t.type === p.scoreType && t.scale === scale);
  if (comparable.some((t) => score >= t.value)) return met(`Your ${yours} meets the cutoff.`);
  if (comparable.length === thresholds.length)
    return unmet(`Asks for at least ${asked}. Your score is ${yours}.`);
  return check(
    `Asks for at least ${asked}. Your ${yours} uses a different scale, and conversions vary by university.`,
  );
}

function experienceVerdict(v: RequirementValue<"experience_band">, experience: ExperienceSummary | null) {
  const band =
    v.minYears !== null && v.maxYears !== null
      ? `${v.minYears}–${v.maxYears} years`
      : v.minYears !== null
        ? `${v.minYears}+ years`
        : `up to ${v.maxYears} years`;
  const paid = experience?.paidMonths ?? null;
  if (paid === null) {
    return check(
      `Asks for ${band} of experience. Confirm your profile with dated work entries to check this.`,
    );
  }
  const grace = SCORING_CONFIG.eligibility.experienceGraceMonths;
  const yours = formatMonths(paid);
  if (v.minYears !== null && paid < v.minYears * 12) {
    const internships = experience?.internshipMonths ?? null;
    if (v.minYears * 12 - paid <= grace || internships === null || paid + internships >= v.minYears * 12) {
      return check(
        `Asks for ${band} of experience. You have ${yours}; check whether the employer counts internships or nearby experience.`,
      );
    }
    return unmet(`Asks for ${band} of experience. Your confirmed profile shows ${yours}.`);
  }
  if (v.maxYears !== null && paid > v.maxYears * 12) {
    if (paid - v.maxYears * 12 <= grace) {
      return check(`Asks for ${band} of experience. You have ${yours}, just above the range.`);
    }
    return unmet(`Asks for ${band} of experience. Your confirmed profile shows ${yours}.`);
  }
  return met(`You have ${yours}, which fits ${band}.`);
}

function availabilityVerdict(v: RequirementValue<"availability">, p: Preferences, today: string): Verdict {
  const deadlines = [v.joinWithinDays === null ? null : addDays(today, v.joinWithinDays), v.startBy]
    .filter((date): date is string => date !== null)
    .sort();
  const deadline = deadlines[0] ?? today;
  const asked = [
    v.joinWithinDays === null
      ? null
      : v.joinWithinDays === 0
        ? "immediate joining"
        : `joining within ${v.joinWithinDays} days`,
    v.startBy === null ? null : `a start by ${formatDate(v.startBy)}`,
  ]
    .filter(Boolean)
    .join(" and ");
  const starts = [
    p.noticePeriodDays === null ? null : addDays(today, p.noticePeriodDays),
    p.availableFrom === null ? null : p.availableFrom < today ? today : p.availableFrom,
  ]
    .filter((date): date is string => date !== null)
    .sort();
  const earliest = starts.at(-1);
  if (!earliest) return check(`Asks for ${asked}. Add your notice period or start date to check this.`);
  const when = earliest === today ? "immediately" : `on ${formatDate(earliest)}`;
  return earliest <= deadline
    ? met(`You can start ${when}, which meets ${asked}.`)
    : unmet(`Asks for ${asked}. The earliest you can start is ${formatDate(earliest)}.`);
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function requirementVerdict(
  requirement: HardRequirement,
  p: Preferences | null,
  experience: ExperienceSummary | null,
  today: string,
): Verdict {
  if (requirement.kind === "experience_band") return experienceVerdict(requirement.value, experience);
  if (!p) return check("Set your preferences and eligibility to check this requirement.");
  switch (requirement.kind) {
    case "location": {
      const v = requirement.value;
      const asked = `${v.relocationAccepted ? "working in" : "being based in"} ${formatList(v.cities, "or")}`;
      const { matched, allRecognized } = assessPlaces(p.locations, v.cities);
      if (matched) return met(`${matched} is one of your cities.`);
      if (p.willingToRelocate === true) {
        return v.relocationAccepted
          ? met(`Requires ${asked}, and you're open to relocating.`)
          : check(`Requires ${asked}. You're open to relocating; confirm the timing works.`);
      }
      if (!p.locations.length || p.willingToRelocate === null || !allRecognized) {
        return check(`Requires ${asked}. Confirm you can work there.`);
      }
      return unmet(`Requires ${asked}. You chose ${formatList(p.locations)} and aren't open to relocating.`);
    }
    case "work_authorization": {
      const v = requirement.value;
      if (v.country !== "IN") {
        return check(
          `Requires authorization to work in ${countryName(v.country)}. Check that you're eligible.`,
        );
      }
      if (p.workAuthorization === null)
        return check("Asks about work authorization. Add yours to check this.");
      if (p.workAuthorization === "authorized") return met("You're authorized to work in India.");
      if (v.sponsorshipAvailable === true) return met("You need sponsorship, and this employer offers it.");
      if (v.sponsorshipAvailable === false) {
        return unmet("Requires authorization to work in India without sponsorship. You said you'd need it.");
      }
      return check("You need sponsorship, and the posting doesn't say whether it's offered.");
    }
    case "degree": {
      const v = requirement.value;
      const verdicts: Verdict[] = [];
      if (v.levels.length || v.degrees.length) verdicts.push(degreeVerdict(v, p));
      if (v.fields.length) verdicts.push(fieldVerdict(v, p));
      if (v.minScores.length) verdicts.push(scoreVerdict(v.minScores, p));
      return combine(verdicts);
    }
    case "graduation_batch": {
      const years = [...new Set(requirement.value.years)].sort((a, b) => a - b);
      const batches = `${formatList(years.map(String))} batch${years.length > 1 ? "es" : ""}`;
      if (p.graduationYear === null)
        return check(`Open to the ${batches}. Add your graduation year to check this.`);
      return years.includes(p.graduationYear)
        ? met(`Your graduation year (${p.graduationYear}) is accepted.`)
        : unmet(`Open to the ${batches}. Your graduation year is ${p.graduationYear}.`);
    }
    case "availability":
      return availabilityVerdict(requirement.value, p, today);
  }
}

/**
 * Deterministic hard filters for one job. Preference checks narrow the search; requirement checks
 * compare the job's stated eligibility with the candidate. `today` is an ISO date.
 */
export function evaluateJobEligibility(
  candidate: CandidateFacts,
  job: JobFacts,
  today: string,
): EligibilityResult {
  const p = candidate.preferences ? normalizePreferences(candidate.preferences) : null;
  const checks: FitCheck[] = [];
  if (p) {
    const filters: [PreferenceFilterKind, Verdict | null][] = [
      ["role", roleFilter(p, job)],
      ["work_mode", workModeFilter(p, job)],
      ["location", locationFilter(p, job)],
      ["employment_type", employmentFilter(p, job)],
      ["salary", salaryFilter(p, job)],
    ];
    for (const [kind, verdict] of filters)
      if (verdict) checks.push({ source: "preference", kind, ...verdict });
  }
  for (const requirement of job.requirements) {
    checks.push({
      source: "requirement",
      kind: requirement.kind,
      quote: requirement.quote,
      ...requirementVerdict(requirement, p, candidate.experience, today),
    });
  }
  const outcome = checks.some((c) => c.status === "unmet")
    ? "excluded"
    : checks.some((c) => c.status === "check")
      ? "check"
      : "eligible";
  return { outcome, checks };
}

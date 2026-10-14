import { cleanJobText, MAX_JOB_CHARACTERS, maskContactDetails } from "./jobs";
import { formatList } from "./preferences";
import { PRODUCT } from "./product";
import { findCities, type KnownCity } from "./terms";
import type { EmploymentType, JobSource, RemoteType, RoleFamily, SeniorityLevel } from "./vocab";

/** Every tunable collection number lives here. Changing a cadence also changes the coverage line. */
export const COLLECTION_CONFIG = {
  /**
   * The scheduled workflow's cadence (.github/workflows/collect.yml). Each run re-lists every board,
   * which is also how board postings are verified, then runs the other checks.
   */
  everyHours: 6,
  /** Pause between requests to the same host. */
  requestGapMs: 400,
  /** A run stops starting new boards after this; the next run begins with the boards it skipped. */
  runBudgetMinutes: 25,
  /** A run marked running for longer than this is treated as crashed, and no longer blocks new runs. */
  staleRunMinutes: 90,
  adzuna: {
    country: "in",
    everyHours: 24,
    maxDaysOld: 7,
    resultsPerPage: 50,
    maxPages: 2,
    /**
     * Adzuna's default limits are 25 requests a minute, 250 a day, 1,000 a week, and 2,500 a month.
     * A full search is 3 places × 4 queries × 2 pages = 24 requests; 40 a day stays under every limit.
     */
    gapMs: 3000,
    dailyRequestLimit: 40,
    places: { Bengaluru: "Bangalore", Hyderabad: "Hyderabad", Pune: "Pune" },
    queries: ["software engineer", "backend developer", "frontend developer", "data analyst"],
    /** Adzuna can't be checked per ad, so an ad it stops returning is assumed closed after this. */
    closeAfterDaysUnseen: 7,
  },
  userLinks: { recheckAfterHours: 24, perRun: 25 },
  pruneClosedPostingsAfterDays: 60,
  /** Share of the shorter description's word triples found in the other one. */
  dedupe: { minTextSimilarity: 0.8 },
  /** A board that suddenly lists nothing is more likely broken than empty, so nothing is closed. */
  emptyBoardGuard: 10,
} as const;

/** `job_runs.kind` for scheduled collection runs; admin stats read them back. */
export const COLLECTION_RUN_KINDS = { ingest: "collect.ingest", verify: "collect.verify" } as const;

export type TargetCity = (typeof PRODUCT.cities)[number];
const TARGET_CITIES: readonly string[] = PRODUCT.cities;

const words = (text: string) =>
  ` ${text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()} `;

/** Checked first: roles outside the three families even when the title says "engineer". */
const OTHER_ROLES =
  /\b(sdet|qa|quality (assurance|engineer|analyst)|test (engineer|automation|analyst)|tester|testing|devops|sre|site reliability|android|ios|mobile|flutter|react native|embedded|firmware|hardware|vlsi|asic|rtl|network (engineer|administrator)|security (engineer|analyst)|support (engineer|analyst|specialist)|solutions? (engineer|architect|consultant)|sales|presales|pre sales|customer (success|support|engineer)|field (engineer|application)|implementation|deployment|data engineer|data engineering|machine learning|ml|ai engineer|data scientist|data science|research (engineer|scientist)|designer|recruiter|recruiting|talent|advocate|developer relations|evangelist)\b/;
const FULL_STACK = /\bfull ?stack\b/;
const FRONTEND =
  /\b(front ?end|ui (engineer|developer)|(react|reactjs|angular|vue|vuejs|javascript|typescript|web) (developer|engineer))\b/;
const DATA_ANALYST =
  /\b((data|bi|business intelligence|product|analytics|reporting|mis|business|insights?|marketing|operations) analyst|analytics (engineer|associate|specialist)|data analytics)\b/;
const BACKEND =
  /\b(back ?end|software (development )?(engineer|developer)|sde|programmer|member of technical staff|mts|application developer|api (developer|engineer)|(java|python|golang|go|node|nodejs|ruby|rails|php|c#|net|dotnet|scala|kotlin|rust|c\+\+) (developer|engineer)|developer)\b/;

/** Role family from a job title, or null when it isn't one of the three families. */
export function roleFamilyFromTitle(title: string): RoleFamily | null {
  const text = words(title);
  if (OTHER_ROLES.test(text)) return null;
  if (FULL_STACK.test(text)) return "backend";
  if (FRONTEND.test(text)) return "frontend";
  if (DATA_ANALYST.test(text)) return "data_analyst";
  if (BACKEND.test(text)) return "backend";
  return null;
}

const LEAD =
  /\b(lead|leader|manager|mgr|head|director|vp|vice president|chief|architect|distinguished|fellow)\b/;
const LEVELED = "(engineer|developer|sde|analyst|member)";
const SENIOR = new RegExp(`\\b(senior|sr|staff|principal)\\b|\\b${LEVELED}\\s*(iii|iv|v|3|4|5)\\b`);
const INTERN = /\b(intern|internship)\b/;
const ENTRY = new RegExp(
  `\\b(junior|jr|entry|graduate|grad|fresher|freshers|trainee|apprentice|associate|campus|early career)\\b|\\b${LEVELED}\\s*(i|1)\\b`,
);
const MID = new RegExp(`\\b${LEVELED}\\s*(ii|2)\\b`);

/**
 * Seniority from the title, then from the source's experience label (LinkedIn-style values such as
 * "Entry level" or "Director"). "Mid-Senior level" says nothing useful, so it stays unknown.
 */
export function seniorityFromTitle(title: string, experienceLabel?: string | null): SeniorityLevel {
  const text = words(title);
  if (LEAD.test(text)) return "lead";
  if (SENIOR.test(text)) return "senior";
  if (INTERN.test(text)) return "intern";
  if (ENTRY.test(text)) return "entry";
  if (MID.test(text)) return "mid";
  const label = words(experienceLabel ?? "");
  if (/\b(director|executive)\b/.test(label)) return "lead";
  if (/\bintern/.test(label)) return "intern";
  if (/\b(entry|associate)\b/.test(label)) return "entry";
  return "unknown";
}

/** Values such as "Full-time", "FullTime", "full_time", "permanent", "Internship", "contract". */
export function employmentTypeFrom(
  hints: readonly (string | null | undefined)[],
  title: string,
): EmploymentType {
  if (INTERN.test(words(title))) return "internship";
  for (const hint of hints) {
    const text = words((hint ?? "").replace(/([a-z])([A-Z])/g, "$1 $2"));
    if (/\bintern/.test(text)) return "internship";
    if (/\b(contract|contractor|temporary|temp|freelance)\b/.test(text)) return "contract";
    if (/\bpart\s*time\b/.test(text)) return "part_time";
    if (/\b(full\s*time|permanent|regular)\b/.test(text)) return "full_time";
  }
  return "unknown";
}

export type LocationFacts = {
  /** Free-text locations as the source gave them. */
  texts: readonly string[];
  /** ISO 3166 alpha-2 codes, any case. */
  countryCodes?: readonly (string | null | undefined)[];
  /** Explicit work-mode fields, such as "remote", "hybrid", "on_site", or a boolean remote flag. */
  workplace?: readonly (string | boolean | null | undefined)[];
};

export type ReadLocation = {
  /** Every Indian city recognized, target or not. */
  cities: KnownCity[];
  targetCities: TargetCity[];
  india: boolean;
  remoteType: RemoteType;
};

const REMOTE_TEXT = /\b(remote|work from home|wfh|anywhere)\b/;
const HYBRID_TEXT = /\bhybrid\b/;

export function readLocation(facts: LocationFacts): ReadLocation {
  const joined = facts.texts.join(" ; ");
  const cities = findCities(joined);
  const india =
    cities.length > 0 ||
    /\bindia\b/.test(words(joined)) ||
    (facts.countryCodes ?? []).some((code) => code?.trim().toLowerCase() === "in");
  const modes = (facts.workplace ?? []).map((mode) =>
    typeof mode === "boolean" ? (mode ? "remote" : "") : words(mode ?? ""),
  );
  const text = words(joined);
  const remoteType: RemoteType = modes.some((mode) => /\bremote\b/.test(mode))
    ? "remote"
    : modes.some((mode) => /\bhybrid\b/.test(mode)) || HYBRID_TEXT.test(text)
      ? "hybrid"
      : REMOTE_TEXT.test(text)
        ? "remote"
        : modes.some((mode) => /\b(on ?site|office|in person)\b/.test(mode))
          ? "onsite"
          : "unknown";
  return {
    cities,
    targetCities: cities.filter((city): city is TargetCity => TARGET_CITIES.includes(city)),
    india,
    remoteType,
  };
}

export type PostingFacts = {
  title: string;
  location: LocationFacts;
  employmentHints?: readonly (string | null | undefined)[];
  experienceLabel?: string | null;
};

export type ScopeDecision =
  | {
      keep: true;
      roleFamily: RoleFamily;
      seniority: SeniorityLevel;
      employmentType: EmploymentType;
      remoteType: RemoteType;
      /** Canonical Indian cities, plus "Remote" for India-remote roles. */
      locations: string[];
    }
  | { keep: false; reason: "location" | "role" | "seniority" };

/**
 * Collection scope (ADR-031): a target city or India-remote, one of the three role families, and
 * not clearly senior. A bare "India" or a remote role with no country is skipped as unknown.
 */
export function assessPosting(facts: PostingFacts): ScopeDecision {
  const place = readLocation(facts.location);
  const indiaRemote = place.india && place.remoteType === "remote";
  if (!place.targetCities.length && !indiaRemote) return { keep: false, reason: "location" };
  const roleFamily = roleFamilyFromTitle(facts.title);
  if (!roleFamily) return { keep: false, reason: "role" };
  const seniority = seniorityFromTitle(facts.title, facts.experienceLabel);
  if (seniority === "senior" || seniority === "lead") return { keep: false, reason: "seniority" };
  return {
    keep: true,
    roleFamily,
    seniority,
    employmentType: employmentTypeFrom(facts.employmentHints ?? [], facts.title),
    remoteType: place.remoteType,
    locations: [...place.cities, ...(indiaRemote ? ["Remote"] : [])],
  };
}

export const JOB_SOURCE_LABELS: Record<JobSource, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  workday: "Workday",
  adzuna: "Adzuna",
  user_paste: "Pasted by you",
  user_url: "Your link",
};

/** Company boards are first-hand; Adzuna ads only point back to them. */
export const isAggregatorSource = (source: JobSource) => source === "adzuna";

/** Collected descriptions are stored masked, so requirement quotes always match the stored text. */
export const collectedDescription = (text: string) =>
  maskContactDetails(cleanJobText(text)).slice(0, MAX_JOB_CHARACTERS).trim();

const EXPIRED =
  /\b(no longer (accepting applications|available|open|active)|(job|position|posting|role|vacancy) (has|have) (been )?(closed|filled|expired)|(job|posting) (is )?(closed|expired)|applications (are )?(now )?closed|this job has expired)\b/i;

/** Page text that says the posting has closed. Only checked on pages fetched for verification. */
export const looksExpired = (text: string) => EXPIRED.test(text.slice(0, 20_000));

export type Coverage = { companies: number; adzuna: boolean };

/**
 * The coverage line under the product promise. Says nothing until a recent run succeeded, so it
 * never claims coverage the collector isn't delivering.
 */
export function describeCoverage(coverage: Coverage): string | null {
  const sources = [
    coverage.companies > 0
      ? `${coverage.companies} company career ${coverage.companies === 1 ? "board" : "boards"}`
      : null,
    coverage.adzuna ? "Adzuna listings" : null,
  ].filter((source): source is string => source !== null);
  if (sources.length === 0) return null;
  const places = formatList([
    ...PRODUCT.cities,
    ...(PRODUCT.includesRemote ? ["remote roles in India"] : []),
  ]);
  const cadence =
    coverage.companies > 0 ? ` Company boards are re-read every ${COLLECTION_CONFIG.everyHours} hours.` : "";
  return `Covering ${formatList(sources)} for ${places}.${cadence}`;
}

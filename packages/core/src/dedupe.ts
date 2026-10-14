import { COLLECTION_CONFIG } from "./collection";
import { findCities, normalizeTerm } from "./terms";

const COMPANY_SUFFIXES = new Set([
  "pvt",
  "private",
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "llc",
  "llp",
  "plc",
  "gmbh",
  "corp",
  "corporation",
  "co",
  "company",
  "india",
  "technologies",
  "technology",
]);

/** "Freshworks Technologies Pvt. Ltd." and "Freshworks" group together. Never empty. */
export function normalizeCompanyName(name: string): string {
  const parts = normalizeTerm(name).split(" ").filter(Boolean);
  while (parts.length > 1 && COMPANY_SUFFIXES.has(parts.at(-1) ?? "")) parts.pop();
  return parts.join(" ");
}

const TITLE_NOISE = new Set(["remote", "hybrid", "onsite", "on", "site", "office", "wfh", "india", "in"]);

/**
 * Location and work-mode words are compared separately, so they're removed from the title:
 * "Software Engineer (Bengaluru, Hybrid)" and "Software Engineer - Bangalore" are the same title.
 */
export function normalizeJobTitle(title: string): string {
  const text = normalizeTerm(title.replace(/\bsr\b\.?/gi, "senior").replace(/\bjr\b\.?/gi, "junior"));
  const kept = text
    .split(" ")
    .filter((word) => word && !TITLE_NOISE.has(word) && findCities(word).length === 0);
  return kept.join(" ") || text;
}

const TRACKING_PARAM =
  /^(utm_.*|gh_src|lever-.*|source|src|ref|referrer|referral|trk.*|iis|iisn|oga|dcr_ci|ccuid|codes)$/i;

/** One URL per posting page: no tracking parameters, fragment, "www.", or trailing "/apply". */
export function canonicalJobUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const path = url.pathname.replace(/\/(apply|application)\/?$/i, "").replace(/\/+$/, "");
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  return `https://${url.hostname.toLowerCase().replace(/^www\./, "")}${path}${query}`;
}

const MAX_WORDS = 4000;

/** Word triples of the normalized text: the unit both similarity measures compare. */
export function shingles(text: string): Set<string> {
  const tokens = normalizeTerm(text).split(" ").filter(Boolean).slice(0, MAX_WORDS);
  const result = new Set<string>();
  if (tokens.length < 3) {
    if (tokens.length) result.add(tokens.join(" "));
    return result;
  }
  for (let i = 0; i + 2 < tokens.length; i++) result.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  return result;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash;
}

/** 64-bit SimHash over word triples, as 16 hex characters. Near-identical texts differ in few bits. */
export function simhash(text: string): string {
  const weights = new Array<number>(64).fill(0);
  for (const shingle of shingles(text)) {
    const hash = fnv1a64(shingle);
    for (let bit = 0; bit < 64; bit++)
      weights[bit] = (weights[bit] ?? 0) + ((hash >> BigInt(bit)) & 1n ? 1 : -1);
  }
  let result = 0n;
  for (let bit = 0; bit < 64; bit++) if ((weights[bit] ?? 0) > 0) result |= 1n << BigInt(bit);
  return result.toString(16).padStart(16, "0");
}

export function simhashSimilarity(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let bits = 0;
  while (diff) {
    bits += Number(diff & 1n);
    diff >>= 1n;
  }
  return 1 - bits / 64;
}

/**
 * Share of the shorter text's word triples that also appear in the longer one. Unlike SimHash this
 * still works when one side is Adzuna's short snippet of the other.
 */
export function textContainment(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  if (!small.size) return 0;
  let shared = 0;
  for (const item of small) if (large.has(item)) shared++;
  return shared / small.size;
}

export type DedupeKey = {
  canonicalUrl: string | null;
  normalizedCompany: string;
  normalizedTitle: string;
  /** Canonical cities, plus "Remote". Empty means unknown. */
  locations: readonly string[];
  description: string;
};

export type DuplicateMatch = { similarity: number; method: "apply_url" | "content" };

const placesOverlap = (a: readonly string[], b: readonly string[]) =>
  !a.length || !b.length || a.some((place) => b.includes(place));

/**
 * Same posting page, or the same company, title, and place with mostly the same description.
 * Separate postings of one role in two cities stay separate jobs.
 */
export function duplicateMatch(posting: DedupeKey, existing: DedupeKey): DuplicateMatch | null {
  if (posting.canonicalUrl && posting.canonicalUrl === existing.canonicalUrl) {
    return { similarity: 1, method: "apply_url" };
  }
  if (
    posting.normalizedCompany !== existing.normalizedCompany ||
    posting.normalizedTitle !== existing.normalizedTitle ||
    !placesOverlap(posting.locations, existing.locations)
  ) {
    return null;
  }
  const similarity = textContainment(posting.description, existing.description);
  return similarity >= COLLECTION_CONFIG.dedupe.minTextSimilarity
    ? { similarity: Math.round(similarity * 1000) / 1000, method: "content" }
    : null;
}

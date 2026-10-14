import { type AtsType, cleanJobText, type JobSalary, type JobSource, type LocationFacts } from "@repo/core";
import type { z } from "zod";
import { type SourceClient, SourceError } from "./client";

/** One company's public board, as stored in the registry. */
export type BoardRef = {
  ats: AtsType;
  boardToken: string;
  companyName: string;
  /** Lever hosts EU customers separately. */
  region?: "eu" | null;
};

/** A posting as listed by a source, before scope filtering and dedupe. */
export type ListedPosting = {
  source: JobSource;
  /** Unique within the source. ATS ids are prefixed with the board token. */
  sourceJobId: string;
  title: string;
  companyName: string;
  location: LocationFacts;
  /** Joined for display and the raw-posting record. */
  locationText: string;
  employmentHints: string[];
  experienceLabel: string | null;
  /** Page a person reads; often also where they apply. */
  sourceUrl: string | null;
  applyUrl: string | null;
  postedAt: string | null;
  salary: JobSalary | null;
  /** Null when the listing carries no description and `detail` must be called. */
  descriptionText: string | null;
  /**
   * Set only when the description needs a separate request. A stored posting with the same value
   * still has the current description, so the request is skipped.
   */
  detailVersion: string | null;
  /** The listing as received, minus description fields (stored as text instead). */
  raw: Record<string, unknown>;
};

export type PostingDetail = {
  descriptionText: string;
  sourceUrl?: string | null;
  applyUrl?: string | null;
  raw: Record<string, unknown>;
};

export type BoardConnector = {
  ats: AtsType;
  /** Every posting currently on the board. Throws `SourceError`. */
  list(board: BoardRef, client: SourceClient): Promise<ListedPosting[]>;
  /** Only for sources whose listing omits descriptions. */
  detail?(board: BoardRef, posting: ListedPosting, client: SourceClient): Promise<PostingDetail>;
};

export function parsePayload<T extends z.ZodType>(schema: T, value: unknown, what: string): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new SourceError("bad_payload", `Unexpected ${what} payload`);
  return result.data;
}

/** Items that don't match the schema are skipped, so one odd posting can't fail a whole board. */
export function parseItems<T extends z.ZodType>(
  schema: T,
  items: readonly unknown[],
): { item: z.output<T>; raw: Record<string, unknown> }[] {
  return items.flatMap((raw) => {
    const result = schema.safeParse(raw);
    return result.success ? [{ item: result.data, raw: raw as Record<string, unknown> }] : [];
  });
}

export const compact = (values: readonly (string | null | undefined)[]) => [
  ...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0)),
];

export function omit(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

export const joinSections = (sections: readonly (string | null | undefined)[]) =>
  cleanJobText(compact(sections).join("\n\n"));

/** Board tokens go into URL paths; anything else would let a registry typo address another endpoint. */
export function boardPath(token: string): string {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(token)) throw new Error(`Invalid board token "${token}"`);
  return encodeURIComponent(token);
}

import { createHash } from "node:crypto";
import {
  type AtsType,
  COLLECTION_CONFIG,
  type DedupeKey,
  type DuplicateMatch,
  duplicateMatch,
  isAggregatorSource,
  JOB_SOURCE_LABELS,
  type JobSource,
  keywordJobExtraction,
  simhash,
  verifyJobExtraction,
} from "@repo/core";
import { and, asc, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "./client";
import { companies, jobDuplicates, jobPostings, jobRequirements, jobs, type PostingFacts } from "./schema";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += CHUNK) result.push(items.slice(start, start + CHUNK));
  return result;
}

/** jsonb reorders object keys, so stored facts are compared by value, not by serialized text. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export type RegistryCompany = {
  slug: string;
  name: string;
  ats: AtsType;
  boardToken: string;
  region?: "eu" | null;
  careersUrl?: string | null;
  hq?: string | null;
  locations: string[];
};

/**
 * Makes the companies table match the seed file. Companies dropped from the file are deactivated,
 * not deleted, so their jobs and history stay intact.
 */
export async function syncCompanyRegistry(db: Database, entries: readonly RegistryCompany[]) {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(companies);
    const bySlug = new Map(existing.map((company) => [company.slug, company]));
    let added = 0;
    let updated = 0;
    for (const entry of entries) {
      const values = {
        name: entry.name,
        atsType: entry.ats,
        boardToken: entry.boardToken,
        atsRegion: entry.region ?? null,
        careersUrl: entry.careersUrl ?? null,
        hq: entry.hq ?? null,
        locations: entry.locations,
        active: true,
      };
      const current = bySlug.get(entry.slug);
      if (!current) {
        await tx.insert(companies).values({ slug: entry.slug, ...values });
        added++;
        continue;
      }
      const stored = {
        name: current.name,
        atsType: current.atsType,
        boardToken: current.boardToken,
        atsRegion: current.atsRegion,
        careersUrl: current.careersUrl,
        hq: current.hq,
        locations: current.locations,
        active: current.active,
      };
      if (stableJson(stored) === stableJson(values)) continue;
      await tx.update(companies).set(values).where(eq(companies.id, current.id));
      updated++;
    }
    const slugs = entries.map((entry) => entry.slug);
    const deactivated = await tx
      .update(companies)
      .set({ active: false })
      .where(
        and(
          eq(companies.active, true),
          isNotNull(companies.atsType),
          slugs.length ? notInArray(companies.slug, slugs) : undefined,
        ),
      )
      .returning({ id: companies.id });
    return { added, updated, deactivated: deactivated.length };
  });
}

export type BoardCompany = {
  id: string;
  slug: string;
  name: string;
  ats: AtsType;
  boardToken: string;
  region: string | null;
  lastCrawledAt: Date | null;
};

/** Least recently crawled first, so a run cut short resumes where the last one stopped. */
export async function listBoardCompanies(db: Database, options: { slugs?: readonly string[] } = {}) {
  const rows = await db
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.active, true),
        isNotNull(companies.atsType),
        isNotNull(companies.boardToken),
        options.slugs?.length ? inArray(companies.slug, [...options.slugs]) : undefined,
      ),
    )
    .orderBy(sql`${companies.lastCrawledAt} asc nulls first`, asc(companies.slug));
  return rows.map(
    (row): BoardCompany => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      ats: row.atsType as AtsType,
      boardToken: row.boardToken as string,
      region: row.atsRegion,
      lastCrawledAt: row.lastCrawledAt,
    }),
  );
}

/** Registry names, for crediting Adzuna ads to a known company. */
export async function listCompanyNames(db: Database) {
  return db.select({ id: companies.id, name: companies.name }).from(companies);
}

export async function markCompanyCrawled(
  db: Database,
  companyId: string,
  error: string | null,
  now = new Date(),
) {
  await db
    .update(companies)
    .set({ lastCrawledAt: now, lastError: error?.slice(0, 500) ?? null })
    .where(eq(companies.id, companyId));
}

export type StoredPosting = {
  detailVersion: string | null;
  descriptionText: string;
  closedAt: Date | null;
};

export async function loadStoredPostings(db: Database, source: JobSource, sourceJobIds: readonly string[]) {
  const result = new Map<string, StoredPosting>();
  for (const ids of chunks(sourceJobIds)) {
    const rows = await db
      .select({
        sourceJobId: jobPostings.sourceJobId,
        detailVersion: jobPostings.detailVersion,
        descriptionText: jobPostings.descriptionText,
        closedAt: jobPostings.closedAt,
      })
      .from(jobPostings)
      .where(and(eq(jobPostings.source, source), inArray(jobPostings.sourceJobId, ids)));
    for (const { sourceJobId, ...row } of rows) result.set(sourceJobId, row);
  }
  return result;
}

export type CollectedPosting = {
  source: JobSource;
  sourceJobId: string;
  companyId: string | null;
  title: string;
  companyName: string;
  locationText: string;
  sourceUrl: string | null;
  applyUrl: string | null;
  /** Already passed through `collectedDescription`. */
  descriptionText: string;
  postedAt: Date | null;
  detailVersion: string | null;
  raw: Record<string, unknown>;
  facts: PostingFacts;
};

export type RecordOutcome = {
  outcome: "new" | "changed" | "unchanged";
  jobId: string;
  /** Set when this posting joined an existing job instead of creating one. */
  grouped: DuplicateMatch | null;
};

type PostingRow = typeof jobPostings.$inferSelect;

const comparable = (row: Pick<PostingRow, keyof Omit<CollectedPosting, "raw">> & { contentHash: string }) =>
  stableJson({
    companyId: row.companyId,
    title: row.title,
    companyName: row.companyName,
    locationText: row.locationText,
    sourceUrl: row.sourceUrl,
    applyUrl: row.applyUrl,
    contentHash: row.contentHash,
    detailVersion: row.detailVersion,
    postedAt: row.postedAt?.toISOString() ?? null,
    facts: row.facts,
  });

/**
 * Stores one in-scope posting and keeps its canonical job current. A new posting joins an open
 * shared job when `duplicateMatch` says it's the same role, otherwise it starts a new job.
 */
export async function recordPosting(
  db: Database,
  posting: CollectedPosting,
  now = new Date(),
): Promise<RecordOutcome> {
  const contentHash = sha256(posting.descriptionText);
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .select()
      .from(jobPostings)
      .where(and(eq(jobPostings.source, posting.source), eq(jobPostings.sourceJobId, posting.sourceJobId)))
      .for("update");
    const values = { ...posting, contentHash, lastSeenAt: now, closedAt: null };

    if (stored?.jobId && comparable(stored) === comparable(values)) {
      await tx
        .update(jobPostings)
        .set({ lastSeenAt: now, closedAt: null, raw: posting.raw })
        .where(eq(jobPostings.id, stored.id));
      if (stored.closedAt) await refreshJob(tx, stored.jobId, now);
      else {
        await tx
          .update(jobs)
          .set({ lastVerifiedAt: sql`greatest(${jobs.lastVerifiedAt}, ${now.toISOString()}::timestamptz)` })
          .where(eq(jobs.id, stored.jobId));
      }
      return { outcome: "unchanged", jobId: stored.jobId, grouped: null };
    }

    let postingId = stored?.id;
    if (stored) await tx.update(jobPostings).set(values).where(eq(jobPostings.id, stored.id));
    else {
      const [inserted] = await tx
        .insert(jobPostings)
        .values({ ...values, firstSeenAt: now })
        .returning({ id: jobPostings.id });
      postingId = inserted?.id;
    }
    if (!postingId) throw new Error("Posting upsert returned no row");

    let jobId = stored?.jobId ?? null;
    let grouped: DuplicateMatch | null = null;
    if (!jobId) {
      const duplicate = await findDuplicate(tx, posting);
      if (duplicate) {
        jobId = duplicate.jobId;
        grouped = duplicate.match;
        await tx
          .insert(jobDuplicates)
          .values({ jobId, postingId, similarity: grouped.similarity, method: grouped.method })
          .onConflictDoNothing();
      } else {
        const [job] = await tx
          .insert(jobs)
          .values({
            ...jobValues({ ...values, firstSeenAt: now }),
            requirementsStatus: "pending",
            firstSeenAt: now,
          })
          .returning({ id: jobs.id });
        if (!job) throw new Error("Job insert returned no row");
        jobId = job.id;
      }
      await tx.update(jobPostings).set({ jobId }).where(eq(jobPostings.id, postingId));
    }
    await refreshJob(tx, jobId, now);
    return { outcome: stored ? "changed" : "new", jobId, grouped };
  });
}

const dedupeKey = (
  facts: Pick<PostingFacts, "canonicalApplyUrl" | "normalizedCompany" | "normalizedTitle" | "locations">,
  description: string,
): DedupeKey => ({
  canonicalUrl: facts.canonicalApplyUrl,
  normalizedCompany: facts.normalizedCompany,
  normalizedTitle: facts.normalizedTitle,
  locations: facts.locations,
  description,
});

async function findDuplicate(tx: Transaction, posting: CollectedPosting) {
  const { facts } = posting;
  const candidates = await tx
    .select({
      id: jobs.id,
      canonicalApplyUrl: jobs.canonicalApplyUrl,
      normalizedCompany: jobs.normalizedCompany,
      normalizedTitle: jobs.normalizedTitle,
      locations: jobs.locations,
      descriptionText: jobs.descriptionText,
    })
    .from(jobs)
    .where(
      and(
        isNull(jobs.ownerUserId),
        isNull(jobs.closedAt),
        or(
          facts.canonicalApplyUrl ? eq(jobs.canonicalApplyUrl, facts.canonicalApplyUrl) : undefined,
          and(
            eq(jobs.normalizedCompany, facts.normalizedCompany),
            eq(jobs.normalizedTitle, facts.normalizedTitle),
          ),
        ),
      ),
    )
    .orderBy(asc(jobs.firstSeenAt))
    .limit(50);
  const key = dedupeKey(facts, posting.descriptionText);
  let best: { jobId: string; match: DuplicateMatch } | null = null;
  for (const candidate of candidates) {
    const match = duplicateMatch(key, dedupeKey(candidate, candidate.descriptionText));
    if (match && (!best || match.similarity > best.match.similarity)) best = { jobId: candidate.id, match };
  }
  return best;
}

type JobSourceRow = Pick<
  PostingRow,
  | "source"
  | "companyId"
  | "title"
  | "companyName"
  | "sourceUrl"
  | "applyUrl"
  | "descriptionText"
  | "contentHash"
  | "facts"
  | "firstSeenAt"
>;

function jobValues(posting: JobSourceRow) {
  const facts = posting.facts as PostingFacts;
  return {
    ownerUserId: null,
    companyId: posting.companyId,
    companyName: posting.companyName,
    title: posting.title,
    normalizedCompany: facts.normalizedCompany,
    normalizedTitle: facts.normalizedTitle,
    normalizedLocation: facts.locations.join(" ").toLowerCase(),
    locations: facts.locations,
    remoteType: facts.remoteType,
    employmentType: facts.employmentType,
    seniority: facts.seniority,
    roleFamily: facts.roleFamily,
    salaryMin: facts.salary?.min == null ? null : Math.round(facts.salary.min),
    salaryMax: facts.salary?.max == null ? null : Math.round(facts.salary.max),
    salaryCurrency: facts.salary?.currency ?? null,
    salaryPeriod: facts.salary?.period ?? null,
    applyUrl: posting.applyUrl ?? posting.sourceUrl,
    canonicalApplyUrl: facts.canonicalApplyUrl,
    source: posting.source,
    sourceName: JOB_SOURCE_LABELS[posting.source],
    sourceUrl: posting.sourceUrl,
    descriptionText: posting.descriptionText,
    contentHash: posting.contentHash,
    simhash: simhash(posting.descriptionText),
  };
}

/** Company boards outrank Adzuna; among equals the first seen wins, so the choice is stable. */
const rankPostings = (a: PostingRow, b: PostingRow) =>
  Number(isAggregatorSource(a.source)) - Number(isAggregatorSource(b.source)) ||
  a.firstSeenAt.getTime() - b.firstSeenAt.getTime() ||
  a.id.localeCompare(b.id);

/**
 * Rebuilds a shared job from its best open posting. A job is open while any posting is, and was
 * last verified when its most recently seen open posting was. Requirements are read again (by
 * keywords, so collection spends no model quota) only when the chosen text changes.
 */
export async function refreshJob(tx: Transaction, jobId: string, now = new Date()) {
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
  if (!job || job.ownerUserId) return;
  const postings = await tx.select().from(jobPostings).where(eq(jobPostings.jobId, jobId));
  const open = postings.filter((posting) => !posting.closedAt && posting.facts).sort(rankPostings);
  const [best] = open;
  if (!best) {
    if (!job.closedAt) await tx.update(jobs).set({ closedAt: now }).where(eq(jobs.id, jobId));
    return;
  }
  const lastVerifiedAt = new Date(Math.max(...open.map((posting) => posting.lastSeenAt.getTime())));
  const values = jobValues(best);
  const reread = job.contentHash !== values.contentHash || job.requirementsStatus !== "ready";
  await tx
    .update(jobs)
    .set({ ...values, closedAt: null, lastVerifiedAt, ...(reread ? { requirementsStatus: "ready" } : {}) })
    .where(eq(jobs.id, jobId));
  if (!reread) return;
  const { job: verified } = verifyJobExtraction(
    keywordJobExtraction(best.descriptionText),
    best.descriptionText,
  );
  await tx.delete(jobRequirements).where(eq(jobRequirements.jobId, jobId));
  if (!verified.requirements.length) return;
  await tx.insert(jobRequirements).values(
    verified.requirements.map((requirement, sortOrder) => ({
      jobId,
      type: requirement.type,
      text: requirement.text,
      quote: requirement.quote,
      normalizedSkill: requirement.skill,
      eligibilityKind: requirement.eligibility?.kind ?? null,
      eligibilityValue: (requirement.eligibility?.value ?? null) as Record<string, unknown> | null,
      sortOrder,
    })),
  );
}

async function closePostings(db: Database, postingIds: readonly string[], now: Date) {
  if (!postingIds.length) return 0;
  return db.transaction(async (tx) => {
    const jobIds = new Set<string>();
    for (const ids of chunks(postingIds)) {
      const closed = await tx
        .update(jobPostings)
        .set({ closedAt: now })
        .where(and(inArray(jobPostings.id, ids), isNull(jobPostings.closedAt)))
        .returning({ jobId: jobPostings.jobId });
      for (const { jobId } of closed) if (jobId) jobIds.add(jobId);
    }
    for (const jobId of jobIds) await refreshJob(tx, jobId, now);
    return postingIds.length;
  });
}

/**
 * Closes a board's open postings that its latest listing no longer includes (or that fell out of
 * scope). A board that lists nothing while many postings are open is treated as broken.
 */
export async function closeMissingPostings(
  db: Database,
  input: { companyId: string; source: JobSource; seen: ReadonlySet<string>; listedCount: number },
  now = new Date(),
) {
  const open = await db
    .select({ id: jobPostings.id, sourceJobId: jobPostings.sourceJobId })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.companyId, input.companyId),
        eq(jobPostings.source, input.source),
        isNull(jobPostings.closedAt),
      ),
    );
  const missing = open.filter((posting) => !input.seen.has(posting.sourceJobId));
  if (!missing.length) return { closed: 0, guarded: false };
  if (input.listedCount === 0 && open.length >= COLLECTION_CONFIG.emptyBoardGuard) {
    return { closed: 0, guarded: true };
  }
  return {
    closed: await closePostings(
      db,
      missing.map((posting) => posting.id),
      now,
    ),
    guarded: false,
  };
}

/** For sources that can't be checked per posting (Adzuna): closed once unseen for a while. */
export async function closeUnseenPostings(
  db: Database,
  source: JobSource,
  unseenSince: Date,
  now = new Date(),
) {
  const stale = await db
    .select({ id: jobPostings.id })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.source, source),
        isNull(jobPostings.closedAt),
        lt(jobPostings.lastSeenAt, unseenSince),
      ),
    );
  return closePostings(
    db,
    stale.map((posting) => posting.id),
    now,
  );
}

/** Raw postings are kept for 60 days after closing; the canonical job (and anyone's tracker entry) stays. */
export async function pruneClosedPostings(db: Database, closedBefore: Date) {
  const removed = await db
    .delete(jobPostings)
    .where(and(isNotNull(jobPostings.closedAt), lt(jobPostings.closedAt, closedBefore)))
    .returning({ id: jobPostings.id });
  return removed.length;
}

/**
 * Private jobs added by link that are due a check. Ordered by last touch rather than last
 * verification, so links that can't be reached don't hold the front of the queue forever.
 */
export async function listUserLinkJobsToRecheck(db: Database, checkedBefore: Date, limit: number) {
  return db
    .select({ id: jobs.id, sourceUrl: jobs.sourceUrl })
    .from(jobs)
    .where(
      and(
        isNotNull(jobs.ownerUserId),
        eq(jobs.source, "user_url"),
        isNull(jobs.closedAt),
        isNotNull(jobs.sourceUrl),
        lt(jobs.lastVerifiedAt, checkedBefore),
      ),
    )
    .orderBy(asc(jobs.updatedAt))
    .limit(limit);
}

/** `unknown` (the page couldn't be read) leaves the verification time alone. */
export async function markUserLinkChecked(
  db: Database,
  jobId: string,
  outcome: "open" | "closed" | "unknown",
  now = new Date(),
) {
  const values =
    outcome === "closed"
      ? { closedAt: now, lastVerifiedAt: now }
      : outcome === "open"
        ? { lastVerifiedAt: now }
        : { updatedAt: now };
  await db
    .update(jobs)
    .set(values)
    .where(and(eq(jobs.id, jobId), isNotNull(jobs.ownerUserId)));
}

import { COLLECTION_RUN_KINDS, type JobSource, SCORING_CONFIG } from "@repo/core";
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  companies,
  connectorCursors,
  jobDuplicates,
  jobPostings,
  jobRequirements,
  jobRuns,
  jobs,
  llmCache,
} from "./schema";

export async function loadCursor(db: Database, connector: string, scope: string) {
  const [row] = await db
    .select({ cursor: connectorCursors.cursor })
    .from(connectorCursors)
    .where(and(eq(connectorCursors.connector, connector), eq(connectorCursors.scope, scope)));
  return row?.cursor ?? null;
}

export async function saveCursor(
  db: Database,
  connector: string,
  scope: string,
  cursor: Record<string, unknown>,
) {
  await db
    .insert(connectorCursors)
    .values({ connector, scope, cursor })
    .onConflictDoUpdate({ target: [connectorCursors.connector, connectorCursors.scope], set: { cursor } });
}

/** A run of this kind that started recently and hasn't finished; a crashed run stops counting after the window. */
export async function findActiveRun(db: Database, kind: string, startedAfter: Date) {
  const [run] = await db
    .select({ id: jobRuns.id, startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .where(and(eq(jobRuns.kind, kind), eq(jobRuns.status, "running"), gt(jobRuns.startedAt, startedAfter)))
    .limit(1);
  return run ?? null;
}

/**
 * For the public coverage line: boards whose latest read succeeded within the freshness window, and
 * whether Adzuna returned anything in it. If collection stops, the line stops claiming coverage.
 */
export async function loadCoverage(db: Database, now = new Date()) {
  const since = new Date(now.getTime() - SCORING_CONFIG.freshness.staleAfterHours * 3_600_000);
  const [boards] = await db
    .select({ value: count() })
    .from(companies)
    .where(and(eq(companies.active, true), gt(companies.lastCrawledAt, since), isNull(companies.lastError)));
  const [adzuna] = await db
    .select({ value: count() })
    .from(jobPostings)
    .where(
      and(eq(jobPostings.source, "adzuna"), isNull(jobPostings.closedAt), gt(jobPostings.lastSeenAt, since)),
    );
  return { companies: boards?.value ?? 0, adzuna: (adzuna?.value ?? 0) > 0 };
}

export type CollectionStats = Awaited<ReturnType<typeof loadCollectionStats>>;

/** Everything /admin shows. Owner-only: the caller checks access. */
export async function loadCollectionStats(db: Database, now = new Date()) {
  const staleBefore = new Date(now.getTime() - SCORING_CONFIG.freshness.staleAfterHours * 3_600_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const shared = isNull(jobs.ownerUserId);

  const boards = await db
    .select({
      ats: companies.atsType,
      total: count(),
      failing: sql<number>`count(*) filter (where ${companies.lastError} is not null)`.mapWith(Number),
      neverCrawled: sql<number>`count(*) filter (where ${companies.lastCrawledAt} is null)`.mapWith(Number),
      lastCrawledAt: sql<Date | null>`max(${companies.lastCrawledAt})`.mapWith((value) =>
        value ? new Date(value) : null,
      ),
    })
    .from(companies)
    .where(and(eq(companies.active, true), isNotNull(companies.atsType)))
    .groupBy(companies.atsType)
    .orderBy(companies.atsType);

  const failingCompanies = await db
    .select({
      slug: companies.slug,
      name: companies.name,
      ats: companies.atsType,
      lastError: companies.lastError,
      lastCrawledAt: companies.lastCrawledAt,
    })
    .from(companies)
    .where(and(eq(companies.active, true), isNotNull(companies.lastError)))
    .orderBy(companies.name)
    .limit(50);

  const openBySource = await db
    .select({
      source: jobs.source,
      open: count(),
      stale:
        sql<number>`count(*) filter (where ${jobs.lastVerifiedAt} < ${staleBefore.toISOString()}::timestamptz)`.mapWith(
          Number,
        ),
    })
    .from(jobs)
    .where(and(shared, isNull(jobs.closedAt)))
    .groupBy(jobs.source)
    .orderBy(desc(count()));

  const [closedThisWeek] = await db
    .select({ value: count() })
    .from(jobs)
    .where(and(shared, gt(jobs.closedAt, weekAgo)));
  const [grouped] = await db
    .select({ value: count() })
    .from(jobDuplicates)
    .innerJoin(jobs, eq(jobs.id, jobDuplicates.jobId))
    .where(isNull(jobs.closedAt));
  const postings = await db
    .select({
      source: jobPostings.source,
      open: sql<number>`count(*) filter (where ${jobPostings.closedAt} is null)`.mapWith(Number),
      closed: sql<number>`count(*) filter (where ${jobPostings.closedAt} is not null)`.mapWith(Number),
    })
    .from(jobPostings)
    .groupBy(jobPostings.source);

  const runs = await db
    .select({
      id: jobRuns.id,
      kind: jobRuns.kind,
      status: jobRuns.status,
      startedAt: jobRuns.startedAt,
      finishedAt: jobRuns.finishedAt,
      error: jobRuns.error,
      result: jobRuns.result,
    })
    .from(jobRuns)
    .where(inArray(jobRuns.kind, Object.values(COLLECTION_RUN_KINDS)))
    .orderBy(desc(jobRuns.createdAt))
    .limit(12);

  const quotes = await db
    .select({
      shared: sql<boolean>`${jobs.ownerUserId} is null`,
      total: count(),
      found:
        sql<number>`count(*) filter (where position(${jobRequirements.quote} in ${jobs.descriptionText}) > 0)`.mapWith(
          Number,
        ),
    })
    .from(jobRequirements)
    .innerJoin(jobs, eq(jobs.id, jobRequirements.jobId))
    .groupBy(sql`${jobs.ownerUserId} is null`);

  const tokens = await db
    .select({
      purpose: llmCache.purpose,
      model: llmCache.model,
      calls: count(),
      inputTokens: sql<number>`coalesce(sum(${llmCache.inputTokens}), 0)`.mapWith(Number),
      outputTokens: sql<number>`coalesce(sum(${llmCache.outputTokens}), 0)`.mapWith(Number),
    })
    .from(llmCache)
    .where(gt(llmCache.createdAt, monthAgo))
    .groupBy(llmCache.purpose, llmCache.model)
    .orderBy(llmCache.purpose, llmCache.model);

  return {
    boards: boards.map((row) => ({ ...row, ats: row.ats as string })),
    failingCompanies,
    jobs: {
      openBySource: openBySource.map((row) => ({ ...row, source: row.source as JobSource })),
      closedThisWeek: closedThisWeek?.value ?? 0,
      groupedDuplicates: grouped?.value ?? 0,
    },
    postings,
    runs,
    quotes: {
      shared: quotes.find((row) => row.shared) ?? { total: 0, found: 0 },
      private: quotes.find((row) => !row.shared) ?? { total: 0, found: 0 },
    },
    tokens,
    staleBefore,
  };
}

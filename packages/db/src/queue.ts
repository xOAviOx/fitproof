import { and, asc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { Database, DbOrTx } from "./client";
import { jobRuns } from "./schema";

/**
 * The only module that knows the job queue is a Postgres table. Swapping to a
 * managed queue later means reimplementing these functions, nothing else.
 */

export type JobRun = typeof jobRuns.$inferSelect;

const MAX_ERROR_LENGTH = 2000;
const BASE_BACKOFF_SECONDS = 30;

export async function enqueueJob(
  db: DbOrTx,
  input: {
    kind: string;
    payload?: Record<string, unknown>;
    userId?: string | null;
    maxAttempts?: number;
    scheduledAt?: Date;
  },
): Promise<JobRun> {
  const [run] = await db
    .insert(jobRuns)
    .values({
      kind: input.kind,
      payload: input.payload ?? {},
      userId: input.userId ?? null,
      maxAttempts: input.maxAttempts ?? 3,
      scheduledAt: input.scheduledAt ?? new Date(),
    })
    .returning();
  if (!run) throw new Error("enqueueJob: insert returned no row");
  return run;
}

/**
 * Atomically leases the next due job of the given kinds. A job whose lease
 * expired (worker crashed mid-run) is claimable again until it runs out of attempts.
 */
export async function claimNextJob(
  db: Database,
  options: { kinds: readonly string[]; leaseSeconds?: number },
): Promise<JobRun | null> {
  if (options.kinds.length === 0) return null;
  const leaseSeconds = options.leaseSeconds ?? 300;

  await db
    .update(jobRuns)
    .set({
      status: "failed",
      error: "Lease expired on the final attempt",
      finishedAt: new Date(),
      lockedUntil: null,
    })
    .where(
      and(
        inArray(jobRuns.kind, [...options.kinds]),
        eq(jobRuns.status, "running"),
        lt(jobRuns.lockedUntil, sql`now()`),
        gte(jobRuns.attempts, jobRuns.maxAttempts),
      ),
    );

  const next = db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(
      and(
        inArray(jobRuns.kind, [...options.kinds]),
        lt(jobRuns.attempts, jobRuns.maxAttempts),
        or(
          and(eq(jobRuns.status, "queued"), lte(jobRuns.scheduledAt, sql`now()`)),
          and(eq(jobRuns.status, "running"), lt(jobRuns.lockedUntil, sql`now()`)),
        ),
      ),
    )
    .orderBy(asc(jobRuns.scheduledAt))
    .limit(1)
    .for("update", { skipLocked: true });

  const [claimed] = await db
    .update(jobRuns)
    .set({
      status: "running",
      attempts: sql`${jobRuns.attempts} + 1`,
      startedAt: sql`now()`,
      lockedUntil: sql`now() + make_interval(secs => ${leaseSeconds})`,
    })
    .where(inArray(jobRuns.id, next))
    .returning();
  return claimed ?? null;
}

/**
 * Leases one specific job, under the same rules as `claimNextJob`. Lets the request that queued a
 * job process it immediately; if that process dies, the lease expires and the worker takes over.
 */
export async function claimJobById(
  db: Database,
  id: string,
  options: { leaseSeconds?: number } = {},
): Promise<JobRun | null> {
  const leaseSeconds = options.leaseSeconds ?? 300;
  const [claimed] = await db
    .update(jobRuns)
    .set({
      status: "running",
      attempts: sql`${jobRuns.attempts} + 1`,
      startedAt: sql`now()`,
      lockedUntil: sql`now() + make_interval(secs => ${leaseSeconds})`,
    })
    .where(
      and(
        eq(jobRuns.id, id),
        lt(jobRuns.attempts, jobRuns.maxAttempts),
        or(
          and(eq(jobRuns.status, "queued"), lte(jobRuns.scheduledAt, sql`now()`)),
          and(eq(jobRuns.status, "running"), lt(jobRuns.lockedUntil, sql`now()`)),
        ),
      ),
    )
    .returning();
  return claimed ?? null;
}

export async function completeJob(
  db: DbOrTx,
  id: string,
  result: Record<string, unknown> = {},
): Promise<void> {
  await db
    .update(jobRuns)
    .set({ status: "succeeded", result, error: null, finishedAt: new Date(), lockedUntil: null })
    .where(eq(jobRuns.id, id));
}

/** Requeues with exponential backoff (30s, 60s, 120s, ...) until attempts are exhausted. */
export async function failJob(
  db: DbOrTx,
  run: Pick<JobRun, "id" | "attempts" | "maxAttempts">,
  error: string,
) {
  const message = error.slice(0, MAX_ERROR_LENGTH);
  if (run.attempts < run.maxAttempts) {
    const delaySeconds = BASE_BACKOFF_SECONDS * 2 ** Math.max(0, run.attempts - 1);
    await db
      .update(jobRuns)
      .set({
        status: "queued",
        error: message,
        lockedUntil: null,
        scheduledAt: sql`now() + make_interval(secs => ${delaySeconds})`,
      })
      .where(eq(jobRuns.id, run.id));
    return { retrying: true as const, delaySeconds };
  }
  await db
    .update(jobRuns)
    .set({ status: "failed", error: message, finishedAt: new Date(), lockedUntil: null })
    .where(eq(jobRuns.id, run.id));
  return { retrying: false as const };
}

/** Pushes a requeued job back, e.g. until a provider quota resets. */
export async function deferJob(db: DbOrTx, id: string, delaySeconds: number) {
  await db
    .update(jobRuns)
    .set({ scheduledAt: sql`now() + make_interval(secs => ${Math.max(1, Math.ceil(delaySeconds))})` })
    .where(and(eq(jobRuns.id, id), eq(jobRuns.status, "queued")));
}

/**
 * Records a scheduled pipeline run (ingest, verify, ...) so it shows up in
 * admin stats. Failures are recorded and rethrown to the caller.
 */
export async function trackRun<T extends Record<string, unknown>>(
  db: Database,
  kind: string,
  fn: (run: JobRun) => Promise<T>,
): Promise<{ run: JobRun; result: T }> {
  const run = await enqueueJob(db, { kind, maxAttempts: 1 });
  const [started] = await db
    .update(jobRuns)
    .set({ status: "running", attempts: 1, startedAt: new Date() })
    .where(eq(jobRuns.id, run.id))
    .returning();
  const current = started ?? run;
  try {
    const result = await fn(current);
    await completeJob(db, current.id, result);
    return { run: current, result };
  } catch (error) {
    await failJob(db, current, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

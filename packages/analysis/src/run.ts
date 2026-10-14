import { JOB_ANALYSIS_KIND, JobInputError } from "@repo/core";
import {
  claimJobById,
  claimNextJob,
  completeJob,
  type Database,
  deferJob,
  failJob,
  type JobRun,
  markJobAnalysisFailed,
  RateLimitError,
} from "@repo/db";
import { z } from "zod";
import { type AnalysisDeps, analyzeJob, errorDetails } from "./analyze";

const payloadSchema = z.object({ jobId: z.uuid() });
/** Long enough for two extraction and two explanation calls with a rate-limit wait each. */
export const ANALYSIS_LEASE_SECONDS = 300;

function failureMessage(error: unknown, retrying: boolean) {
  if (error instanceof JobInputError) return error.message;
  if (error instanceof RateLimitError) {
    return retrying
      ? "The analysis quota is used up for now. Your job is queued and will be analysed automatically."
      : "The analysis quota is used up. Add the job again later.";
  }
  return retrying
    ? "Analysis hit a temporary problem and will retry automatically."
    : "We couldn't analyse this job. Add it again later.";
}

/** Runs one leased analysis job and records the outcome on the run and the job. */
export async function processAnalysisRun(db: Database, deps: AnalysisDeps, run: JobRun) {
  const payload = payloadSchema.safeParse(run.payload);
  if (!payload.success || !run.userId) {
    await failJob(db, { ...run, maxAttempts: 1 }, "Invalid job analysis run");
    return { ok: false as const, retrying: false };
  }
  const { jobId } = payload.data;
  try {
    const metrics = await analyzeJob(db, deps, { userId: run.userId, jobId });
    await completeJob(db, run.id, metrics);
    return { ok: true as const, metrics };
  } catch (error) {
    const permanent = error instanceof JobInputError;
    const retrying = !permanent && run.attempts < run.maxAttempts;
    const retry = await failJob(
      db,
      permanent ? { ...run, maxAttempts: 1 } : run,
      failureMessage(error, retrying),
    );
    if (error instanceof RateLimitError && retry.retrying) {
      await deferJob(db, run.id, error.retryAfterSeconds);
    }
    if (!retry.retrying) await markJobAnalysisFailed(db, jobId);
    deps.logger?.warn(
      {
        runId: run.id,
        jobId,
        permanent,
        retrying: retry.retrying,
        ...errorDetails(error),
      },
      "job analysis deferred or failed",
    );
    return { ok: false as const, retrying: retry.retrying };
  }
}

/** Processes one specific queued run now, if it is still claimable. */
export async function processAnalysisRunById(db: Database, deps: AnalysisDeps, runId: string) {
  const run = await claimJobById(db, runId, { leaseSeconds: ANALYSIS_LEASE_SECONDS });
  return run ? processAnalysisRun(db, deps, run) : null;
}

/** Worker loop: drains due analysis runs until the limit or the deadline. */
export async function runQueuedAnalyses(
  db: Database,
  deps: AnalysisDeps,
  options: { maxJobs?: number; deadlineMs?: number } = {},
) {
  let processed = 0;
  let failed = 0;
  const deadline = Date.now() + (options.deadlineMs ?? 4 * 60_000);
  while (processed < (options.maxJobs ?? 10) && Date.now() < deadline) {
    const run = await claimNextJob(db, { kinds: [JOB_ANALYSIS_KIND], leaseSeconds: ANALYSIS_LEASE_SECONDS });
    if (!run) break;
    processed++;
    const outcome = await processAnalysisRun(db, deps, run);
    if (!outcome.ok) failed++;
  }
  return { processed, failed };
}

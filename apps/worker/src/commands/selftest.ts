import { type Database, pingDatabase, trackRun } from "@repo/db";
import type { Logger } from "pino";

/** Proves the worker can reach Postgres and record a run in the queue table. */
export async function selftest(db: Database, logger: Logger): Promise<string> {
  await pingDatabase(db);
  const { run } = await trackRun(db, "selftest", async (current) => {
    logger.info({ runId: current.id }, "selftest running");
    return { ok: true };
  });
  logger.info({ runId: run.id }, "selftest succeeded");
  return run.id;
}

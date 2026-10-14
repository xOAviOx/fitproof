import { createAnalysisDeps, parseOptionalLlmEnv, runQueuedAnalyses } from "@repo/analysis";
import type { Database } from "@repo/db";
import type { Logger } from "pino";

/**
 * Fallback for analyses the web request didn't finish (closed tab, timeout, quota). Without LLM
 * settings it reads jobs by keyword, the same as the web app.
 */
export async function analyzeJobs(db: Database, logger: Logger, source: Record<string, string | undefined>) {
  const deps = createAnalysisDeps(db, parseOptionalLlmEnv(source), { logger });
  if (deps.mode === "keywords") {
    logger.warn("No usable LLM settings; reading jobs by keyword with structured explanations");
  }
  const result = await runQueuedAnalyses(db, deps);
  logger.info(result, "job analysis batch finished");
  return result;
}

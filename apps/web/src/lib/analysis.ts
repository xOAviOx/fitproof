import "server-only";
import {
  type AnalysisDeps,
  createAnalysisDeps,
  parseOptionalLlmEnv,
  processAnalysisRunById,
} from "@repo/analysis";
import { PRODUCT } from "@repo/core";
import { after } from "next/server";
import { serverEnv } from "@/env";
import { getDb } from "@/lib/db";
import { databaseErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

let deps: (AnalysisDeps & { mode: "model" | "keywords" }) | undefined;

/** Model-backed when LLM settings are present; otherwise the keyword reader. */
export function analysisDeps() {
  if (!deps) {
    deps = createAnalysisDeps(getDb(), parseOptionalLlmEnv(process.env), { logger });
    if (deps.mode === "keywords") logger.warn("No usable LLM settings; reading jobs by keyword");
  }
  return deps;
}

/**
 * Analyses a queued run after the response is sent. If this process dies, the lease expires and the
 * next status poll or the scheduled worker picks the run up again.
 */
export function analyzeInBackground(runId: string) {
  after(async () => {
    try {
      await processAnalysisRunById(getDb(), analysisDeps(), runId);
    } catch (error) {
      logger.error(
        { runId, err: error instanceof Error ? error.name : "unknown", code: databaseErrorCode(error) },
        "background job analysis crashed",
      );
    }
  });
}

const BOT_TOKEN = `${PRODUCT.name}Bot`;

export function jobFetchOptions() {
  return {
    userAgent: `${BOT_TOKEN}/0.3 (+${new URL("/bot", serverEnv().NEXT_PUBLIC_SITE_URL).href})`,
    robotsToken: BOT_TOKEN,
  };
}

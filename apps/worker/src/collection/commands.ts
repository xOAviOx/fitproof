import { parseArgs } from "node:util";
import { ADZUNA_HOST, BOARD_CONNECTORS, createSourceClient } from "@repo/connectors";
import { BOT, botUserAgent, COLLECTION_CONFIG, COLLECTION_RUN_KINDS } from "@repo/core";
import { type Database, findActiveRun, trackRun } from "@repo/db";
import type { Logger } from "pino";
import { z } from "zod";
import { ingest } from "./ingest";
import { loadSeed } from "./seed";
import { verify } from "./verify";

const optional = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const collectionEnvSchema = z.object({
  /** The bot's User-Agent links to this site's /bot page. */
  NEXT_PUBLIC_SITE_URL: z.url(),
  ADZUNA_APP_ID: optional,
  ADZUNA_APP_KEY: optional,
});

export function parseCollectionEnv(source: Record<string, string | undefined>) {
  const result = collectionEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid or missing environment variables:\n${issues.join("\n")}\nSee .env.example.`);
  }
  const { ADZUNA_APP_ID: appId, ADZUNA_APP_KEY: appKey } = result.data;
  if (Boolean(appId) !== Boolean(appKey))
    throw new Error("Set both ADZUNA_APP_ID and ADZUNA_APP_KEY, or neither.");
  return {
    siteUrl: result.data.NEXT_PUBLIC_SITE_URL,
    adzunaKeys: appId && appKey ? { appId, appKey } : null,
  };
}

/** Overlapping runs would double the load on every board; a crashed run stops blocking after a while. */
async function alreadyRunning(db: Database, logger: Logger, kind: string) {
  const since = new Date(Date.now() - COLLECTION_CONFIG.staleRunMinutes * 60_000);
  const active = await findActiveRun(db, kind, since);
  if (active)
    logger.warn({ runId: active.id, startedAt: active.startedAt }, `another ${kind} run is in progress`);
  return Boolean(active);
}

export async function ingestCommand(db: Database, logger: Logger, args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      company: { type: "string", multiple: true },
      "no-adzuna": { type: "boolean", default: false },
    },
    strict: true,
  });
  const env = parseCollectionEnv(process.env);
  if (await alreadyRunning(db, logger, COLLECTION_RUN_KINDS.ingest)) return null;
  const client = createSourceClient({
    userAgent: botUserAgent(env.siteUrl),
    robotsToken: BOT.token,
    minGapMs: COLLECTION_CONFIG.requestGapMs,
    hostGapMs: { [ADZUNA_HOST]: COLLECTION_CONFIG.adzuna.gapMs },
    keyedApiHosts: [ADZUNA_HOST],
  });
  const seed = await loadSeed();
  const { run, result } = await trackRun(db, COLLECTION_RUN_KINDS.ingest, async () => {
    const outcome = await ingest(
      { db, logger, client, connectors: BOARD_CONNECTORS, adzunaKeys: env.adzunaKeys },
      { seed, companies: values.company, skipAdzuna: values["no-adzuna"] },
    );
    const boards = Object.entries(outcome.sources).filter(([source]) => source !== "adzuna");
    const attempted = boards.reduce((sum, [, stats]) => sum + (stats?.boards ?? 0), 0);
    const failed = boards.reduce((sum, [, stats]) => sum + (stats?.failed ?? 0), 0);
    if (attempted > 0 && failed === attempted) {
      throw new Error(`Every board failed; first error: ${outcome.failures[0]?.error ?? "unknown"}`);
    }
    return outcome;
  });
  logger.info({ runId: run.id, ...summarize(result) }, "ingest finished");
  return result;
}

export async function verifyCommand(db: Database, logger: Logger) {
  const env = parseCollectionEnv(process.env);
  if (await alreadyRunning(db, logger, COLLECTION_RUN_KINDS.verify)) return null;
  const { run, result } = await trackRun(db, COLLECTION_RUN_KINDS.verify, () =>
    verify({ db, logger, pageOptions: { userAgent: botUserAgent(env.siteUrl), robotsToken: BOT.token } }),
  );
  logger.info({ runId: run.id }, "verify finished");
  return result;
}

function summarize(result: Awaited<ReturnType<typeof ingest>>) {
  return {
    registry: result.registry,
    adzuna: result.adzuna,
    partial: result.partial,
    requests: result.requests,
    failures: result.failures.length,
    sources: Object.fromEntries(
      Object.entries(result.sources).map(([source, stats]) => [
        source,
        stats &&
          `${stats.boards} boards (${stats.failed} failed), ${stats.inScope}/${stats.listed} in scope, ${stats.new} new, ${stats.grouped} grouped, ${stats.closed} closed`,
      ]),
    ),
  };
}

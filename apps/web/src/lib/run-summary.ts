import { COLLECTION_RUN_KINDS } from "@repo/core";
import { z } from "zod";

const n = z.number().int().nonnegative().catch(0);

const sourceStats = z.object({
  boards: n,
  failed: n,
  listed: n,
  inScope: n,
  new: n,
  changed: n,
  closed: n,
  grouped: n,
  postingErrors: n,
});

const ingestResult = z.object({
  sources: z.record(z.string(), sourceStats.catch(sourceStats.parse({}))).catch({}),
  failures: z.array(z.unknown()).catch([]),
  adzuna: z.string().catch("unknown"),
  partial: z.boolean().catch(false),
  requests: n,
});

const verifyResult = z.object({
  adzunaClosed: n,
  userLinks: z.object({ checked: n, closed: n, unknown: n }).catch({ checked: 0, closed: 0, unknown: 0 }),
  pruned: n,
});

const ADZUNA_STATUS: Record<string, string> = {
  ran: "Adzuna searched",
  not_due: "Adzuna not due",
  no_keys: "Adzuna keys missing",
  skipped: "Adzuna skipped",
  daily_limit: "Adzuna daily limit reached",
};

/** One line per run for /admin. `result` is stored jsonb, so anything unexpected degrades to zeros. */
export function summarizeRun(kind: string, result: unknown): string | null {
  if (result === null || typeof result !== "object") return null;
  if (kind === COLLECTION_RUN_KINDS.ingest) {
    const data = ingestResult.parse(result);
    const all = Object.values(data.sources);
    const sum = (key: keyof z.infer<typeof sourceStats>) =>
      all.reduce((total, stats) => total + stats[key], 0);
    const boards = Object.entries(data.sources)
      .filter(([source]) => source !== "adzuna")
      .reduce(
        (total, [, stats]) => ({ boards: total.boards + stats.boards, failed: total.failed + stats.failed }),
        {
          boards: 0,
          failed: 0,
        },
      );
    return [
      `${boards.boards} boards (${boards.failed} failed)`,
      `${sum("inScope")} of ${sum("listed")} postings in scope`,
      `${sum("new")} new, ${sum("changed")} changed, ${sum("closed")} closed, ${sum("grouped")} grouped`,
      sum("postingErrors") ? `${sum("postingErrors")} posting errors` : null,
      ADZUNA_STATUS[data.adzuna] ?? `Adzuna: ${data.adzuna}`,
      `${data.requests} requests`,
      data.partial ? "stopped at the time budget" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (kind === COLLECTION_RUN_KINDS.verify) {
    const data = verifyResult.parse(result);
    return [
      `${data.adzunaClosed} Adzuna ads closed`,
      `${data.userLinks.checked} user links checked (${data.userLinks.closed} closed, ${data.userLinks.unknown} unreachable)`,
      `${data.pruned} old postings pruned`,
    ].join(" · ");
  }
  return null;
}

export function formatDuration(startedAt: Date | null, finishedAt: Date | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

import { fetchJobPage, JobPageError, type JobPageOptions } from "@repo/connectors";
import { COLLECTION_CONFIG, looksExpired, SCORING_CONFIG } from "@repo/core";
import {
  closeUnseenPostings,
  type Database,
  listUserLinkJobsToRecheck,
  markUserLinkChecked,
  pruneClosedPostings,
} from "@repo/db";
import type { Logger } from "pino";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export type VerifyDeps = {
  db: Database;
  logger: Logger;
  pageOptions: JobPageOptions;
  fetchPage?: typeof fetchJobPage;
  now?: () => Date;
};

export type VerifyResult = {
  adzunaClosed: number;
  userLinks: { checked: number; open: number; closed: number; unknown: number };
  pruned: number;
  staleAfterHours: number;
  [key: string]: unknown;
};

/**
 * The checks a board re-listing can't do: Adzuna ads unseen for a week close, links users added are
 * re-read (a 404 or an "expired" notice closes them), and raw postings closed for 60 days are pruned.
 */
export async function verify(deps: VerifyDeps): Promise<VerifyResult> {
  const now = deps.now ?? (() => new Date());
  const fetchPage = deps.fetchPage ?? fetchJobPage;
  const start = now();
  const adzunaClosed = await closeUnseenPostings(
    deps.db,
    "adzuna",
    new Date(start.getTime() - COLLECTION_CONFIG.adzuna.closeAfterDaysUnseen * DAY),
    start,
  );

  const userLinks = { checked: 0, open: 0, closed: 0, unknown: 0 };
  const due = await listUserLinkJobsToRecheck(
    deps.db,
    new Date(start.getTime() - COLLECTION_CONFIG.userLinks.recheckAfterHours * HOUR),
    COLLECTION_CONFIG.userLinks.perRun,
  );
  for (const job of due) {
    if (!job.sourceUrl) continue;
    userLinks.checked++;
    let outcome: "open" | "closed" | "unknown";
    try {
      const page = await fetchPage(job.sourceUrl, deps.pageOptions);
      outcome = looksExpired(page.text) ? "closed" : "open";
    } catch (error) {
      outcome = error instanceof JobPageError && error.code === "not_found" ? "closed" : "unknown";
    }
    userLinks[outcome]++;
    await markUserLinkChecked(deps.db, job.id, outcome, now());
  }

  const pruned = await pruneClosedPostings(
    deps.db,
    new Date(start.getTime() - COLLECTION_CONFIG.pruneClosedPostingsAfterDays * DAY),
  );
  const result = {
    adzunaClosed,
    userLinks,
    pruned,
    staleAfterHours: SCORING_CONFIG.freshness.staleAfterHours,
  };
  deps.logger.info(result, "verification finished");
  return result;
}

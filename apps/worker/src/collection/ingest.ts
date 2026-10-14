import {
  type AdzunaKeys,
  type BoardConnector,
  type BoardRef,
  type ListedPosting,
  type SourceClient,
  SourceError,
  searchAdzuna,
} from "@repo/connectors";
import {
  assessPosting,
  COLLECTION_CONFIG,
  canonicalJobUrl,
  collectedDescription,
  type JobSource,
  normalizeCompanyName,
  normalizeJobTitle,
  PRODUCT,
  type ScopeDecision,
} from "@repo/core";
import {
  type BoardCompany,
  closeMissingPostings,
  type Database,
  listBoardCompanies,
  listCompanyNames,
  loadCursor,
  loadStoredPostings,
  markCompanyCrawled,
  type RecordOutcome,
  type RegistryCompany,
  recordPosting,
  saveCursor,
  syncCompanyRegistry,
} from "@repo/db";
import type { Logger } from "pino";

type Kept = Extract<ScopeDecision, { keep: true }>;

export type SourceStats = {
  boards: number;
  failed: number;
  listed: number;
  inScope: number;
  skipped: { location: number; role: number; seniority: number };
  new: number;
  changed: number;
  unchanged: number;
  grouped: number;
  closed: number;
  /** Postings whose description couldn't be fetched or stored. */
  postingErrors: number;
};

export type IngestFailure = { company: string; source: JobSource; error: string };

export type IngestResult = {
  sources: Partial<Record<JobSource, SourceStats>>;
  failures: IngestFailure[];
  registry: { added: number; updated: number; deactivated: number } | null;
  adzuna: "ran" | "not_due" | "no_keys" | "skipped" | "daily_limit";
  /** True when the time budget ran out before every board was read. */
  partial: boolean;
  requests: number;
  [key: string]: unknown;
};

export type IngestDeps = {
  db: Database;
  logger: Logger;
  client: SourceClient;
  connectors: Partial<Record<string, BoardConnector>>;
  adzunaKeys: AdzunaKeys | null;
  now?: () => Date;
};

export type IngestOptions = {
  /** Registry entries from the seed file; synced before crawling. */
  seed?: readonly RegistryCompany[] | null;
  /** Only these company slugs; Adzuna is skipped. */
  companies?: readonly string[];
  skipAdzuna?: boolean;
  budgetMs?: number;
};

const emptyStats = (): SourceStats => ({
  boards: 0,
  failed: 0,
  listed: 0,
  inScope: 0,
  skipped: { location: 0, role: 0, seniority: 0 },
  new: 0,
  changed: 0,
  unchanged: 0,
  grouped: 0,
  closed: 0,
  postingErrors: 0,
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

function factsFor(posting: ListedPosting, decision: Kept, companyName: string) {
  return {
    roleFamily: decision.roleFamily,
    seniority: decision.seniority,
    employmentType: decision.employmentType,
    remoteType: decision.remoteType,
    locations: decision.locations,
    salary: posting.salary,
    normalizedCompany: normalizeCompanyName(companyName),
    normalizedTitle: normalizeJobTitle(posting.title),
    canonicalApplyUrl: canonicalJobUrl(posting.applyUrl ?? posting.sourceUrl),
  };
}

const assess = (posting: ListedPosting) =>
  assessPosting({
    title: posting.title,
    location: posting.location,
    employmentHints: posting.employmentHints,
    experienceLabel: posting.experienceLabel,
  });

function countDecision(stats: SourceStats, decision: ScopeDecision) {
  if (decision.keep) stats.inScope++;
  else stats.skipped[decision.reason]++;
}

function countOutcome(stats: SourceStats, outcome: RecordOutcome) {
  stats[outcome.outcome]++;
  if (outcome.grouped) stats.grouped++;
}

/**
 * Reads every active board in the registry (least recently crawled first), stores in-scope
 * postings, groups duplicates, and closes postings a board stopped listing. One board's failure is
 * recorded on the company and in the result; the run carries on.
 */
export async function ingest(deps: IngestDeps, options: IngestOptions = {}): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const budgetMs = options.budgetMs ?? COLLECTION_CONFIG.runBudgetMinutes * 60_000;
  const result: IngestResult = {
    sources: {},
    failures: [],
    registry: options.seed ? await syncCompanyRegistry(deps.db, options.seed) : null,
    adzuna: "skipped",
    partial: false,
    requests: 0,
  };
  const statsFor = (source: JobSource) => {
    result.sources[source] ??= emptyStats();
    return result.sources[source];
  };

  const boards = await listBoardCompanies(deps.db, { slugs: options.companies });
  if (options.companies?.length && boards.length !== options.companies.length) {
    const found = new Set(boards.map((board) => board.slug));
    const missing = options.companies.filter((slug) => !found.has(slug));
    throw new Error(`Not in the active registry: ${missing.join(", ")}`);
  }
  for (const board of boards) {
    if (Date.now() - started > budgetMs) {
      result.partial = true;
      break;
    }
    await ingestBoard(deps, board, statsFor(board.ats), result.failures, now);
  }

  if (!options.skipAdzuna && !options.companies?.length && !result.partial) {
    result.adzuna = await ingestAdzuna(deps, statsFor("adzuna"), result.failures, now);
  }
  result.requests = deps.client.requests;
  return result;
}

async function ingestBoard(
  deps: IngestDeps,
  board: BoardCompany,
  stats: SourceStats,
  failures: IngestFailure[],
  now: () => Date,
) {
  const { db, logger, client } = deps;
  stats.boards++;
  const connector = deps.connectors[board.ats];
  const fail = async (error: string) => {
    stats.failed++;
    failures.push({ company: board.slug, source: board.ats, error });
    await markCompanyCrawled(db, board.id, error, now());
    logger.warn({ company: board.slug, ats: board.ats, error }, "board failed");
  };
  if (!connector) return fail(`No connector for ${board.ats}`);
  const ref: BoardRef = {
    ats: board.ats,
    boardToken: board.boardToken,
    companyName: board.name,
    region: board.region === "eu" ? "eu" : null,
  };

  let listed: ListedPosting[];
  try {
    listed = await connector.list(ref, client);
  } catch (error) {
    return fail(message(error));
  }
  stats.listed += listed.length;
  const kept: { posting: ListedPosting; decision: Kept }[] = [];
  for (const posting of listed) {
    const decision = assess(posting);
    countDecision(stats, decision);
    if (decision.keep) kept.push({ posting, decision });
  }

  const stored = await loadStoredPostings(
    db,
    board.ats,
    kept.map(({ posting }) => posting.sourceJobId),
  );
  const seen = new Set<string>();
  let postingErrors = 0;
  for (const { posting, decision } of kept) {
    seen.add(posting.sourceJobId);
    let description = posting.descriptionText;
    let { sourceUrl, applyUrl, raw } = posting;
    if (description === null) {
      const prior = stored.get(posting.sourceJobId);
      if (prior && prior.detailVersion === posting.detailVersion) description = prior.descriptionText;
      else {
        try {
          const detail = await connector.detail?.(ref, posting, client);
          if (!detail) throw new Error("listing has no description and no detail endpoint");
          description = detail.descriptionText;
          sourceUrl = detail.sourceUrl ?? sourceUrl;
          applyUrl = detail.applyUrl ?? applyUrl;
          raw = { ...raw, detail: detail.raw };
        } catch (error) {
          postingErrors++;
          logger.debug({ posting: posting.sourceJobId, error: message(error) }, "detail failed");
          // Without a fresh description, keep the stored one (still listed, so still open).
          if (!prior) continue;
          description = prior.descriptionText;
        }
      }
    }
    const descriptionText = collectedDescription(description);
    if (!descriptionText) continue;
    try {
      const outcome = await recordPosting(
        db,
        {
          source: board.ats,
          sourceJobId: posting.sourceJobId,
          companyId: board.id,
          title: posting.title,
          companyName: board.name,
          locationText: posting.locationText,
          sourceUrl,
          applyUrl,
          descriptionText,
          postedAt: parseDate(posting.postedAt),
          detailVersion: posting.detailVersion,
          raw,
          facts: factsFor(posting, decision, board.name),
        },
        now(),
      );
      countOutcome(stats, outcome);
    } catch (error) {
      postingErrors++;
      logger.error({ posting: posting.sourceJobId, error: message(error) }, "posting not stored");
    }
  }
  stats.postingErrors += postingErrors;

  const closing = await closeMissingPostings(
    db,
    { companyId: board.id, source: board.ats, seen, listedCount: listed.length },
    now(),
  );
  stats.closed += closing.closed;
  if (closing.guarded) {
    return fail(
      "The board listed no jobs while many were open, so nothing was closed. Check the board token.",
    );
  }
  await markCompanyCrawled(db, board.id, null, now());
  logger.info(
    { company: board.slug, ats: board.ats, listed: listed.length, kept: kept.length, closed: closing.closed },
    "board read",
  );
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const ADZUNA_CURSOR = { connector: "adzuna", scope: "search" } as const;
const adzunaCursorSchema = (value: Record<string, unknown> | null) => ({
  lastRunAt: typeof value?.lastRunAt === "string" ? new Date(value.lastRunAt) : null,
  day: typeof value?.day === "string" ? value.day : "",
  requests: typeof value?.requests === "number" ? value.requests : 0,
});

/**
 * Searches Adzuna for each target city and role query, at most once a day and under a daily request
 * cap kept below Adzuna's own limit. Ads are snippets, so most of them group under a company's own
 * posting; the rest become jobs credited to Adzuna.
 */
async function ingestAdzuna(
  deps: IngestDeps,
  stats: SourceStats,
  failures: IngestFailure[],
  now: () => Date,
): Promise<IngestResult["adzuna"]> {
  const { db, logger, client, adzunaKeys } = deps;
  if (!adzunaKeys) return "no_keys";
  const config = COLLECTION_CONFIG.adzuna;
  const cursor = adzunaCursorSchema(await loadCursor(db, ADZUNA_CURSOR.connector, ADZUNA_CURSOR.scope));
  const start = now();
  if (cursor.lastRunAt && start.getTime() - cursor.lastRunAt.getTime() < config.everyHours * 3_600_000) {
    return "not_due";
  }
  const day = start.toISOString().slice(0, 10);
  let requests = cursor.day === day ? cursor.requests : 0;
  const registry = new Map(
    (await listCompanyNames(db)).map((company) => [normalizeCompanyName(company.name), company]),
  );
  let outcome: IngestResult["adzuna"] = "ran";

  search: for (const city of PRODUCT.cities) {
    for (const what of config.queries) {
      for (let page = 1; page <= config.maxPages; page++) {
        if (requests >= config.dailyRequestLimit) {
          outcome = "daily_limit";
          break search;
        }
        requests++;
        let postings: ListedPosting[];
        try {
          ({ postings } = await searchAdzuna(
            adzunaKeys,
            {
              country: config.country,
              what,
              where: config.places[city],
              page,
              resultsPerPage: config.resultsPerPage,
              maxDaysOld: config.maxDaysOld,
            },
            client,
          ));
        } catch (error) {
          stats.failed++;
          failures.push({ company: `adzuna:${city}:${what}`, source: "adzuna", error: message(error) });
          // Rejected keys fail every query the same way.
          if (error instanceof SourceError && (error.status === 401 || error.status === 403)) break search;
          break;
        }
        stats.listed += postings.length;
        for (const posting of postings) {
          const decision = assess(posting);
          countDecision(stats, decision);
          const descriptionText = collectedDescription(posting.descriptionText ?? "");
          if (!decision.keep || !descriptionText) continue;
          const known = registry.get(normalizeCompanyName(posting.companyName));
          const companyName = known?.name ?? posting.companyName;
          try {
            countOutcome(
              stats,
              await recordPosting(
                db,
                {
                  source: "adzuna",
                  sourceJobId: posting.sourceJobId,
                  companyId: known?.id ?? null,
                  title: posting.title,
                  companyName,
                  locationText: posting.locationText,
                  sourceUrl: posting.sourceUrl,
                  applyUrl: posting.applyUrl,
                  descriptionText,
                  postedAt: parseDate(posting.postedAt),
                  detailVersion: null,
                  raw: posting.raw,
                  facts: factsFor(posting, decision, companyName),
                },
                now(),
              ),
            );
          } catch (error) {
            stats.postingErrors++;
            logger.error({ posting: posting.sourceJobId, error: message(error) }, "Adzuna ad not stored");
          }
        }
        if (postings.length < config.resultsPerPage) break;
      }
    }
  }
  stats.boards = 1;
  await saveCursor(db, ADZUNA_CURSOR.connector, ADZUNA_CURSOR.scope, {
    lastRunAt: start.toISOString(),
    day,
    requests,
  });
  logger.info({ requests, listed: stats.listed, kept: stats.inScope }, "Adzuna searched");
  return outcome;
}

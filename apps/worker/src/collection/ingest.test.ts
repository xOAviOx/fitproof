import {
  type BoardConnector,
  JobPageError,
  type ListedPosting,
  type SourceClient,
  SourceError,
} from "@repo/connectors";
import { createUserJob, type Database, type RegistryCompany, schema } from "@repo/db";
import { createAuthUser, createTestDb, type TestDb } from "@repo/db/testing";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingest } from "./ingest";
import { verify } from "./verify";

const logger = pino({ level: "silent" });
const HOUR = 3_600_000;
const T0 = new Date("2026-10-10T00:00:00Z");
let clock = T0.getTime();
const now = () => new Date(clock);

const DESCRIPTION = `About the role
You will build payment APIs for merchants across India and keep them fast and reliable for every user.
Requirements
- Strong Node.js and PostgreSQL skills
- Experience with Docker
Write tests, review code, and work with product managers on new features every week of the year.`;

const SEED: RegistryCompany[] = [
  { slug: "acme", name: "Acme", ats: "greenhouse", boardToken: "acme", locations: ["Bengaluru"] },
  { slug: "globex", name: "Globex", ats: "lever", boardToken: "globex", locations: ["Pune"] },
];

function listed(id: string, overrides: Partial<ListedPosting> = {}): ListedPosting {
  return {
    source: "greenhouse",
    sourceJobId: `acme/${id}`,
    title: "Backend Engineer",
    companyName: "Acme",
    location: { texts: ["Bengaluru, India"] },
    locationText: "Bengaluru, India",
    employmentHints: ["Full-time"],
    experienceLabel: null,
    sourceUrl: `https://boards.greenhouse.io/acme/jobs/${id}`,
    applyUrl: `https://boards.greenhouse.io/acme/jobs/${id}`,
    postedAt: "2026-10-01T00:00:00Z",
    salary: null,
    descriptionText: null,
    detailVersion: "v1",
    raw: { id },
    ...overrides,
  };
}

/** A Greenhouse-like board whose listing omits descriptions. */
function fakeBoard() {
  const state = { postings: [] as ListedPosting[], details: 0, fail: null as Error | null };
  const connector: BoardConnector = {
    ats: "greenhouse",
    async list() {
      if (state.fail) throw state.fail;
      return state.postings;
    },
    async detail(_board, posting) {
      state.details++;
      return { descriptionText: `${posting.title}\n${DESCRIPTION}`, raw: { detail: true } };
    },
  };
  return { state, connector };
}

function fakeClient(responses: Record<string, unknown> = {}): SourceClient & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    requests: 0,
    async getJson(url) {
      urls.push(url);
      const match = Object.entries(responses).find(([prefix]) => url.startsWith(prefix));
      if (!match) throw new SourceError("not_found", "no route", 404);
      return match[1];
    },
  };
}

let test: TestDb;
let db: Database;

beforeAll(async () => {
  test = await createTestDb();
  db = test.db;
}, 60_000);
afterAll(async () => {
  await test.close();
});
beforeEach(async () => {
  clock = T0.getTime();
  await db.delete(schema.jobs);
  await db.delete(schema.jobPostings);
  await db.delete(schema.companies);
  await db.delete(schema.connectorCursors);
});

const openJobs = async () =>
  (await db.select().from(schema.jobs)).filter((job) => !job.ownerUserId && !job.closedAt);

describe("ingest", () => {
  it("stores in-scope postings, fetches descriptions only when they change, and closes removed ones", async () => {
    const acme = fakeBoard();
    acme.state.postings = [
      listed("1"),
      listed("2", { title: "Senior Backend Engineer" }),
      listed("3", { title: "Sales Manager" }),
      listed("4", { location: { texts: ["London, UK"] }, locationText: "London, UK" }),
      listed("5", { title: "Data Analyst", location: { texts: ["Remote - India"] } }),
    ];
    const lever: BoardConnector = { ats: "lever", list: async () => [] };
    const deps = {
      db,
      logger,
      client: fakeClient(),
      connectors: { greenhouse: acme.connector, lever },
      adzunaKeys: null,
      now,
    };

    const first = await ingest(deps, { seed: SEED });
    expect(first.registry).toEqual({ added: 2, updated: 0, deactivated: 0 });
    expect(first.sources.greenhouse).toMatchObject({
      boards: 1,
      failed: 0,
      listed: 5,
      inScope: 2,
      skipped: { location: 1, role: 1, seniority: 1 },
      new: 2,
    });
    expect(first.adzuna).toBe("no_keys");
    expect(acme.state.details).toBe(2);
    const jobs = await openJobs();
    expect(jobs.map((job) => [job.title, job.locations, job.remoteType]).sort()).toEqual([
      ["Backend Engineer", ["Bengaluru"], "unknown"],
      ["Data Analyst", ["Remote"], "remote"],
    ]);

    clock += 6 * HOUR;
    const second = await ingest(deps, { seed: SEED });
    expect(second.sources.greenhouse).toMatchObject({ new: 0, unchanged: 2, closed: 0 });
    expect(acme.state.details).toBe(2);

    clock += 6 * HOUR;
    acme.state.postings = [listed("1", { detailVersion: "v2", title: "Backend Engineer" })];
    const third = await ingest(deps, { seed: SEED });
    // A new detail version is fetched again, even though the text turned out the same.
    expect(third.sources.greenhouse).toMatchObject({ changed: 1, unchanged: 0, closed: 1 });
    expect(acme.state.details).toBe(3);
    expect((await openJobs()).map((job) => job.title)).toEqual(["Backend Engineer"]);
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.slug, "acme"));
    expect(company).toMatchObject({ lastError: null, lastCrawledAt: now() });
  });

  it("records a failing board on the company and carries on with the rest", async () => {
    const acme = fakeBoard();
    acme.state.postings = [listed("1")];
    const lever: BoardConnector = {
      ats: "lever",
      list: async () => {
        throw new SourceError("not_found", "api.lever.co/v0/postings/globex returned 404", 404);
      },
    };
    const result = await ingest(
      {
        db,
        logger,
        client: fakeClient(),
        connectors: { greenhouse: acme.connector, lever },
        adzunaKeys: null,
        now,
      },
      { seed: SEED },
    );
    expect(result.failures).toEqual([
      { company: "globex", source: "lever", error: "api.lever.co/v0/postings/globex returned 404" },
    ]);
    expect(result.sources.lever).toMatchObject({ boards: 1, failed: 1 });
    expect(result.sources.greenhouse).toMatchObject({ new: 1 });
    const [globex] = await db.select().from(schema.companies).where(eq(schema.companies.slug, "globex"));
    expect(globex?.lastError).toContain("404");
  });

  it("keeps postings open when a busy board suddenly lists nothing", async () => {
    const acme = fakeBoard();
    acme.state.postings = Array.from({ length: 10 }, (_, index) =>
      listed(String(index), { title: `Backend Engineer (Team ${index})` }),
    );
    const deps = {
      db,
      logger,
      client: fakeClient(),
      connectors: { greenhouse: acme.connector },
      adzunaKeys: null,
      now,
    };
    await ingest(deps, { seed: [SEED[0] as RegistryCompany] });
    acme.state.postings = [];
    const result = await ingest(deps, { seed: [SEED[0] as RegistryCompany] });
    expect(result.sources.greenhouse).toMatchObject({ closed: 0, failed: 1 });
    expect(await openJobs()).toHaveLength(10);
  });

  it("stops at the time budget and resumes with the boards it skipped", async () => {
    const acme = fakeBoard();
    const lever: BoardConnector = { ats: "lever", list: async () => [] };
    const deps = {
      db,
      logger,
      client: fakeClient(),
      connectors: { greenhouse: acme.connector, lever },
      adzunaKeys: null,
      now,
    };
    await ingest(deps, { seed: SEED, budgetMs: 0, companies: ["acme"] });
    clock += HOUR;
    const result = await ingest(deps, { seed: SEED, budgetMs: -1 });
    expect(result.partial).toBe(true);
    expect(result.sources).toEqual({});
    const order = await db.select().from(schema.companies);
    expect(order.find((company) => company.slug === "globex")?.lastCrawledAt).toBeNull();
    await expect(ingest(deps, { companies: ["missing"] })).rejects.toThrow(/missing/);
  });

  it("searches Adzuna once a day and groups its snippets under the company's own posting", async () => {
    const acme = fakeBoard();
    acme.state.postings = [listed("1")];
    const ad = {
      id: "900",
      title: "<strong>Backend</strong> Engineer",
      description: `Backend Engineer ${DESCRIPTION.split(/\s+/).slice(0, 25).join(" ")}…`,
      redirect_url: "https://www.adzuna.in/land/ad/900",
      company: { display_name: "Acme Technologies Pvt Ltd" },
      location: { display_name: "Bangalore, Karnataka", area: ["India", "Karnataka", "Bangalore"] },
    };
    const other = {
      ...ad,
      id: "901",
      title: "Data Analyst",
      description:
        "Analyse sales data with SQL and Excel for a retail chain in Pune. Build weekly dashboards.",
      company: { display_name: "Initech" },
      location: { display_name: "Pune, Maharashtra", area: ["India", "Maharashtra", "Pune"] },
    };
    const client = fakeClient({
      "https://api.adzuna.com/v1/api/jobs/in/search/1?": { count: 2, results: [ad, other] },
    });
    const deps = {
      db,
      logger,
      client,
      connectors: { greenhouse: acme.connector },
      adzunaKeys: { appId: "id", appKey: "key" },
      now,
    };
    const result = await ingest(deps, { seed: [SEED[0] as RegistryCompany] });
    expect(result.adzuna).toBe("ran");
    // 3 cities x 4 queries, one page each (fewer results than a full page).
    expect(client.urls).toHaveLength(12);
    expect(result.sources.adzuna).toMatchObject({ inScope: 24, grouped: 1, new: 2 });
    const jobs = await openJobs();
    expect(jobs.map((job) => [job.title, job.source, job.companyName]).sort()).toEqual([
      ["Backend Engineer", "greenhouse", "Acme"],
      ["Data Analyst", "adzuna", "Initech"],
    ]);

    clock += 6 * HOUR;
    expect((await ingest(deps, { seed: [SEED[0] as RegistryCompany] })).adzuna).toBe("not_due");
    expect(client.urls).toHaveLength(12);
  });
});

describe("verify", () => {
  it("closes stale Adzuna ads and dead user links, and prunes old raw postings", async () => {
    const client = fakeClient({
      "https://api.adzuna.com/": {
        results: [
          {
            id: "901",
            title: "Data Analyst",
            description: "Analyse sales data with SQL and Excel for a retail chain in Pune.",
            redirect_url: "https://www.adzuna.in/land/ad/901",
            company: { display_name: "Initech" },
            location: { display_name: "Pune, Maharashtra" },
          },
        ],
      },
    });
    await ingest(
      { db, logger, client, connectors: {}, adzunaKeys: { appId: "id", appKey: "key" }, now },
      { seed: [SEED[0] as RegistryCompany] },
    );
    const user = await createAuthUser(db);
    const links = [];
    for (const path of ["open", "gone", "expired", "down"]) {
      links.push(
        await createUserJob(db, user, {
          source: "user_url",
          description: `${DESCRIPTION} ${path}`,
          sourceUrl: `https://jobs.example.com/${path}`,
          title: null,
          company: null,
        }),
      );
    }

    clock += 8 * 24 * HOUR;
    const fetchPage = async (url: string) => {
      if (url.endsWith("/gone")) throw new JobPageError("not_found", "gone");
      if (url.endsWith("/down")) throw new JobPageError("unreachable", "down");
      const text = url.endsWith("/expired") ? "This job is no longer accepting applications." : DESCRIPTION;
      return { title: null, company: null, text, method: "readability" as const, url };
    };
    const first = await verify({
      db,
      logger,
      pageOptions: { userAgent: "x", robotsToken: "x" },
      fetchPage,
      now,
    });
    expect(first).toMatchObject({
      adzunaClosed: 1,
      userLinks: { checked: 4, open: 1, closed: 2, unknown: 1 },
      pruned: 0,
    });
    const closed = (await db.select().from(schema.jobs))
      .filter((job) => job.closedAt)
      .map((job) => job.sourceUrl);
    expect(closed.sort()).toEqual([
      "https://jobs.example.com/expired",
      "https://jobs.example.com/gone",
      "https://www.adzuna.in/land/ad/901",
    ]);

    clock += 61 * 24 * HOUR;
    const later = await verify({
      db,
      logger,
      pageOptions: { userAgent: "x", robotsToken: "x" },
      fetchPage,
      now,
    });
    expect(later.pruned).toBe(1);
  });
});

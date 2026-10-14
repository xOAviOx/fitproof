import {
  COLLECTION_RUN_KINDS,
  canonicalJobUrl,
  collectedDescription,
  normalizeCompanyName,
  normalizeJobTitle,
} from "@repo/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type CollectedPosting,
  closeMissingPostings,
  closeUnseenPostings,
  listBoardCompanies,
  listUserLinkJobsToRecheck,
  markCompanyCrawled,
  markUserLinkChecked,
  pruneClosedPostings,
  recordPosting,
  syncCompanyRegistry,
} from "./collection";
import { findActiveRun, loadCollectionStats, loadCoverage, loadCursor, saveCursor } from "./collection-stats";
import { schema } from "./index";
import { createUserJob } from "./jobs";
import { trackRun } from "./queue";
import { createAuthUser, createTestDb, type TestDb } from "./testing/pglite";

let test: TestDb;
let acmeId: string;

const DESCRIPTION = collectedDescription(`About the role
You will build payment APIs for merchants across India and keep them fast and reliable.
Requirements
- Strong Node.js and PostgreSQL skills
- Experience with Docker
Nice to have
- Kafka
Write tests, review code, and work closely with product managers on new features every week.`);

const HOUR = 3_600_000;
const T0 = new Date("2026-10-10T00:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

function posting(overrides: Partial<CollectedPosting> & { sourceJobId: string }): CollectedPosting {
  const title = overrides.title ?? "Backend Engineer";
  const companyName = overrides.companyName ?? "Acme";
  const applyUrl = overrides.applyUrl ?? `https://boards.greenhouse.io/acme/jobs/${overrides.sourceJobId}`;
  return {
    source: "greenhouse",
    companyId: acmeId,
    title,
    companyName,
    locationText: "Bengaluru, India",
    sourceUrl: applyUrl,
    applyUrl,
    descriptionText: DESCRIPTION,
    postedAt: null,
    detailVersion: "v1",
    raw: { id: overrides.sourceJobId },
    ...overrides,
    facts: {
      roleFamily: "backend",
      seniority: "entry",
      employmentType: "full_time",
      remoteType: "hybrid",
      locations: ["Bengaluru"],
      salary: null,
      normalizedCompany: normalizeCompanyName(companyName),
      normalizedTitle: normalizeJobTitle(title),
      canonicalApplyUrl: canonicalJobUrl(applyUrl),
      ...overrides.facts,
    },
  };
}

const adzuna = (sourceJobId: string, overrides: Partial<CollectedPosting> = {}) =>
  posting({
    source: "adzuna",
    sourceJobId,
    companyId: null,
    companyName: "Acme Technologies Pvt Ltd",
    applyUrl: `https://www.adzuna.in/land/ad/${sourceJobId}`,
    descriptionText: DESCRIPTION.split(/\s+/).slice(0, 30).join(" "),
    detailVersion: null,
    ...overrides,
  });

const jobRow = async (jobId: string) => {
  const [row] = await test.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!row) throw new Error("job missing");
  return row;
};

beforeAll(async () => {
  test = await createTestDb();
}, 30_000);
afterAll(async () => {
  await test.close();
});
beforeEach(async () => {
  await test.db.delete(schema.jobs);
  await test.db.delete(schema.jobPostings);
  await test.db.delete(schema.companies);
  await syncCompanyRegistry(test.db, [
    { slug: "acme", name: "Acme", ats: "greenhouse", boardToken: "acme", locations: ["Bengaluru"] },
  ]);
  const [acme] = await listBoardCompanies(test.db);
  acmeId = acme?.id ?? "";
});

describe("company registry", () => {
  it("adds, updates, and deactivates companies to match the seed file", async () => {
    const seed = [
      {
        slug: "acme",
        name: "Acme",
        ats: "greenhouse" as const,
        boardToken: "acme",
        locations: ["Bengaluru"],
      },
      {
        slug: "globex",
        name: "Globex",
        ats: "lever" as const,
        boardToken: "globex",
        region: "eu" as const,
        locations: [],
      },
    ];
    expect(await syncCompanyRegistry(test.db, seed)).toEqual({ added: 1, updated: 0, deactivated: 0 });
    expect(await syncCompanyRegistry(test.db, seed)).toEqual({ added: 0, updated: 0, deactivated: 0 });
    await markCompanyCrawled(test.db, acmeId, null, at(0));
    const order = await listBoardCompanies(test.db);
    expect(order.map((company) => [company.slug, company.region])).toEqual([
      ["globex", "eu"],
      ["acme", null],
    ]);
    expect(
      await syncCompanyRegistry(test.db, [{ ...seed[0], name: "Acme Corp" } as (typeof seed)[number]]),
    ).toEqual({ added: 0, updated: 1, deactivated: 1 });
    expect((await listBoardCompanies(test.db)).map((company) => company.name)).toEqual(["Acme Corp"]);
    expect(await listBoardCompanies(test.db, { slugs: ["globex"] })).toEqual([]);
  });
});

describe("recordPosting", () => {
  it("creates a shared job, reads its requirements by keywords, and skips unchanged repeats", async () => {
    const first = await recordPosting(test.db, posting({ sourceJobId: "acme/1" }), at(0));
    expect(first).toMatchObject({ outcome: "new", grouped: null });
    const job = await jobRow(first.jobId);
    expect(job).toMatchObject({
      ownerUserId: null,
      companyId: acmeId,
      title: "Backend Engineer",
      normalizedCompany: "acme",
      source: "greenhouse",
      sourceName: "Greenhouse",
      locations: ["Bengaluru"],
      roleFamily: "backend",
      requirementsStatus: "ready",
      canonicalApplyUrl: "https://boards.greenhouse.io/acme/jobs/acme/1",
      closedAt: null,
    });
    expect(job.simhash).toMatch(/^[0-9a-f]{16}$/);
    const requirements = await test.db
      .select()
      .from(schema.jobRequirements)
      .where(eq(schema.jobRequirements.jobId, first.jobId));
    expect(requirements.map((row) => [row.normalizedSkill, row.type])).toEqual(
      expect.arrayContaining([
        ["nodejs", "core_skill"],
        ["kafka", "nice_to_have"],
      ]),
    );
    for (const row of requirements) expect(job.descriptionText).toContain(row.quote);

    const again = await recordPosting(test.db, posting({ sourceJobId: "acme/1" }), at(6));
    expect(again).toEqual({ outcome: "unchanged", jobId: first.jobId, grouped: null });
    expect((await jobRow(first.jobId)).lastVerifiedAt).toEqual(at(6));
    const ids = (
      await test.db.select().from(schema.jobRequirements).where(eq(schema.jobRequirements.jobId, first.jobId))
    ).map((row) => row.id);
    expect(ids.sort()).toEqual(requirements.map((row) => row.id).sort());

    const edited = DESCRIPTION.replace("Experience with Docker", "Experience with Docker and AWS");
    const changed = await recordPosting(
      test.db,
      posting({ sourceJobId: "acme/1", descriptionText: edited }),
      at(7),
    );
    expect(changed.outcome).toBe("changed");
    const reread = await test.db
      .select()
      .from(schema.jobRequirements)
      .where(eq(schema.jobRequirements.jobId, first.jobId));
    expect(reread.map((row) => row.normalizedSkill)).toContain("aws");
  });

  it("groups an Adzuna ad under the company's own posting and keeps the board's data", async () => {
    const board = await recordPosting(test.db, posting({ sourceJobId: "acme/1" }), at(0));
    const ad = await recordPosting(test.db, adzuna("900"), at(1));
    expect(ad).toEqual({ outcome: "new", jobId: board.jobId, grouped: { similarity: 1, method: "content" } });
    const job = await jobRow(board.jobId);
    expect(job).toMatchObject({ source: "greenhouse", companyName: "Acme", lastVerifiedAt: at(1) });
    const duplicates = await test.db.select().from(schema.jobDuplicates);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ jobId: board.jobId, method: "content", similarity: 1 });
  });

  it("switches an Adzuna-first job to the company's posting once it arrives", async () => {
    const ad = await recordPosting(test.db, adzuna("900"), at(0));
    expect((await jobRow(ad.jobId)).source).toBe("adzuna");
    const board = await recordPosting(test.db, posting({ sourceJobId: "acme/1" }), at(1));
    expect(board.jobId).toBe(ad.jobId);
    expect(await jobRow(ad.jobId)).toMatchObject({
      source: "greenhouse",
      companyName: "Acme",
      descriptionText: DESCRIPTION,
      applyUrl: "https://boards.greenhouse.io/acme/jobs/acme/1",
    });
  });

  it("groups by apply URL across titles, and keeps other cities, titles, and private jobs apart", async () => {
    const base = await recordPosting(test.db, posting({ sourceJobId: "acme/1" }), at(0));
    const sameUrl = await recordPosting(
      test.db,
      posting({
        sourceJobId: "acme/1-copy",
        title: "SDE 1",
        applyUrl: "https://boards.greenhouse.io/acme/jobs/acme/1?gh_src=linkedin",
        descriptionText: "A totally different text that still points at the same page.",
      }),
      at(0),
    );
    expect(sameUrl).toMatchObject({ jobId: base.jobId, grouped: { method: "apply_url" } });

    const pune = await recordPosting(
      test.db,
      posting({ sourceJobId: "acme/2", facts: { locations: ["Pune"] } as CollectedPosting["facts"] }),
      at(0),
    );
    expect(pune.jobId).not.toBe(base.jobId);
    const frontend = await recordPosting(
      test.db,
      posting({ sourceJobId: "acme/3", title: "Frontend Engineer" }),
      at(0),
    );
    expect(frontend.jobId).not.toBe(base.jobId);

    const user = await createAuthUser(test.db);
    const own = await createUserJob(test.db, user, {
      source: "user_paste",
      description: DESCRIPTION,
      sourceUrl: null,
      title: "Backend Engineer",
      company: "Acme",
    });
    await test.db.update(schema.jobs).set({ normalizedCompany: "acme" }).where(eq(schema.jobs.id, own.jobId));
    await test.db.delete(schema.jobPostings).where(eq(schema.jobPostings.sourceJobId, "acme/1"));
    await test.db.delete(schema.jobPostings).where(eq(schema.jobPostings.sourceJobId, "acme/1-copy"));
    await test.db.delete(schema.jobs).where(eq(schema.jobs.id, base.jobId));
    const fresh = await recordPosting(test.db, posting({ sourceJobId: "acme/4" }), at(0));
    expect(fresh.jobId).not.toBe(own.jobId);
  });
});

describe("closing", () => {
  it("closes postings a board stops listing, and the job once none are open", async () => {
    const board = await recordPosting(test.db, posting({ sourceJobId: "acme/1" }), at(0));
    await recordPosting(test.db, adzuna("900"), at(0));
    const other = await recordPosting(
      test.db,
      posting({ sourceJobId: "acme/2", title: "Data Analyst" }),
      at(0),
    );

    const result = await closeMissingPostings(
      test.db,
      { companyId: acmeId, source: "greenhouse", seen: new Set(["acme/2"]), listedCount: 40 },
      at(6),
    );
    expect(result).toEqual({ closed: 1, guarded: false });
    const kept = await jobRow(board.jobId);
    expect(kept).toMatchObject({ closedAt: null, source: "adzuna" });
    expect((await jobRow(other.jobId)).closedAt).toBeNull();

    expect(await closeUnseenPostings(test.db, "adzuna", at(5), at(7))).toBe(1);
    expect((await jobRow(board.jobId)).closedAt).toEqual(at(7));

    const reopened = await recordPosting(test.db, posting({ sourceJobId: "acme/1" }), at(8));
    expect(reopened).toMatchObject({ outcome: "unchanged", jobId: board.jobId });
    expect(await jobRow(board.jobId)).toMatchObject({
      closedAt: null,
      source: "greenhouse",
      lastVerifiedAt: at(8),
    });
  });

  it("does not close anything when a busy board suddenly lists nothing", async () => {
    for (let index = 0; index < 10; index++) {
      await recordPosting(
        test.db,
        posting({ sourceJobId: `acme/${index}`, title: `Backend Engineer ${index}` }),
        at(0),
      );
    }
    const input = { companyId: acmeId, source: "greenhouse" as const, seen: new Set<string>() };
    expect(await closeMissingPostings(test.db, { ...input, listedCount: 0 }, at(6))).toEqual({
      closed: 0,
      guarded: true,
    });
    expect(await closeMissingPostings(test.db, { ...input, listedCount: 3 }, at(6))).toEqual({
      closed: 10,
      guarded: false,
    });
  });

  it("prunes raw postings 60 days after closing but keeps the job", async () => {
    const board = await recordPosting(test.db, posting({ sourceJobId: "acme/1" }), at(0));
    await closeMissingPostings(
      test.db,
      { companyId: acmeId, source: "greenhouse", seen: new Set(), listedCount: 1 },
      at(1),
    );
    expect(await pruneClosedPostings(test.db, at(0))).toBe(0);
    expect(await pruneClosedPostings(test.db, at(2))).toBe(1);
    expect((await jobRow(board.jobId)).closedAt).toEqual(at(1));
  });
});

describe("user links", () => {
  it("lists private link jobs due a check and records the outcome", async () => {
    const user = await createAuthUser(test.db);
    const own = await createUserJob(test.db, user, {
      source: "user_url",
      description: DESCRIPTION,
      sourceUrl: "https://jobs.example.com/1",
      title: null,
      company: null,
    });
    const due = await listUserLinkJobsToRecheck(test.db, new Date(Date.now() + HOUR), 10);
    expect(due).toEqual([{ id: own.jobId, sourceUrl: "https://jobs.example.com/1" }]);
    await markUserLinkChecked(test.db, own.jobId, "unknown");
    expect((await jobRow(own.jobId)).closedAt).toBeNull();
    await markUserLinkChecked(test.db, own.jobId, "closed", at(3));
    expect(await jobRow(own.jobId)).toMatchObject({ closedAt: at(3), lastVerifiedAt: at(3) });
    expect(await listUserLinkJobsToRecheck(test.db, new Date(Date.now() + HOUR), 10)).toEqual([]);
  });
});

describe("runs, cursors, and stats", () => {
  it("tracks cursors and active runs", async () => {
    expect(await loadCursor(test.db, "adzuna", "search")).toBeNull();
    await saveCursor(test.db, "adzuna", "search", { day: "2026-10-10", requests: 3 });
    await saveCursor(test.db, "adzuna", "search", { day: "2026-10-10", requests: 5 });
    expect(await loadCursor(test.db, "adzuna", "search")).toEqual({ day: "2026-10-10", requests: 5 });

    let active: unknown = "unset";
    await trackRun(test.db, COLLECTION_RUN_KINDS.ingest, async () => {
      active = await findActiveRun(test.db, COLLECTION_RUN_KINDS.ingest, new Date(Date.now() - HOUR));
      return {};
    });
    expect(active).not.toBeNull();
    expect(await findActiveRun(test.db, COLLECTION_RUN_KINDS.ingest, new Date(Date.now() - HOUR))).toBeNull();
  });

  it("reports coverage, failures, open and stale jobs, duplicates, and quote validity", async () => {
    await recordPosting(test.db, posting({ sourceJobId: "acme/1" }), new Date());
    await recordPosting(test.db, adzuna("900"), new Date());
    await recordPosting(test.db, posting({ sourceJobId: "acme/2", title: "Data Analyst" }), at(0));
    expect(await loadCoverage(test.db)).toEqual({ companies: 0, adzuna: true });
    await markCompanyCrawled(test.db, acmeId, null);
    expect(await loadCoverage(test.db)).toEqual({ companies: 1, adzuna: true });
    expect(await loadCoverage(test.db, new Date(Date.now() + 49 * HOUR))).toEqual({
      companies: 0,
      adzuna: false,
    });
    await markCompanyCrawled(test.db, acmeId, "boards-api.greenhouse.io/v1/boards/acme/jobs returned 404");

    const stats = await loadCollectionStats(test.db);
    expect(stats.boards).toEqual([
      expect.objectContaining({ ats: "greenhouse", total: 1, failing: 1, neverCrawled: 0 }),
    ]);
    expect(stats.failingCompanies).toEqual([
      expect.objectContaining({ slug: "acme", lastError: expect.stringContaining("404") }),
    ]);
    expect(stats.jobs.openBySource).toEqual([{ source: "greenhouse", open: 2, stale: 1 }]);
    expect(stats.jobs.groupedDuplicates).toBe(1);
    expect(stats.postings).toEqual(
      expect.arrayContaining([
        { source: "greenhouse", open: 2, closed: 0 },
        { source: "adzuna", open: 1, closed: 0 },
      ]),
    );
    expect(stats.quotes.shared.total).toBeGreaterThan(0);
    expect(stats.quotes.shared.found).toBe(stats.quotes.shared.total);
  });
});

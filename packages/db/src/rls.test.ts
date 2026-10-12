import { EMBEDDING_DIMENSIONS } from "@repo/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "./client";
import { withUserContext } from "./rls";
import * as s from "./schema";
import { createAuthUser, createTestDb, type TestDb } from "./testing/pglite";

const OWN_ROW_TABLES = [
  "candidate_profiles",
  "profile_experiences",
  "profile_projects",
  "profile_education",
  "profile_certifications",
  "profile_skills",
  "resume_files",
  "resume_versions",
  "preferences",
  "profile_embeddings",
  "matches",
  "match_feedback",
  "saved_jobs",
  "applications",
  "tailoring_suggestions",
] as const;

const embedding = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i % 7) / 7);

async function insertJob(db: Database, ownerUserId: string | null, title: string) {
  const [job] = await db
    .insert(s.jobs)
    .values({
      ownerUserId,
      companyName: "Acme",
      title,
      normalizedCompany: "acme",
      normalizedTitle: title.toLowerCase(),
      source: ownerUserId ? "user_paste" : "greenhouse",
      sourceName: ownerUserId ? "Pasted by you" : "Greenhouse",
      descriptionText: `${title} description`,
      contentHash: `hash-${title}`,
    })
    .returning({ id: s.jobs.id });
  if (!job) throw new Error("job insert failed");
  await db.insert(s.jobRequirements).values({
    jobId: job.id,
    type: "core_skill",
    text: "TypeScript",
    quote: "Experience with TypeScript",
  });
  return job.id;
}

/** One row per user-owned table, inserted as the table owner (bypassing RLS). */
async function seedUser(db: Database, userId: string, jobId: string) {
  const [profile] = await db.insert(s.candidateProfiles).values({ userId }).returning();
  if (!profile) throw new Error("profile insert failed");
  const profileId = profile.id;
  await db.insert(s.profileExperiences).values({ userId, profileId, company: "Co", title: "Intern" });
  await db.insert(s.profileProjects).values({ userId, profileId, name: "Project" });
  await db.insert(s.profileEducation).values({ userId, profileId, institution: "College" });
  await db.insert(s.profileCertifications).values({ userId, profileId, name: "Cert" });
  await db.insert(s.profileSkills).values({ userId, profileId, name: "SQL", normalizedName: "sql" });
  await db.insert(s.resumeFiles).values({
    userId,
    storagePath: `${userId}/resume.pdf`,
    originalFilename: "resume.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1000,
    sha256: "abc",
  });
  const [version] = await db
    .insert(s.resumeVersions)
    .values({ userId, profileId, label: "Base", content: {}, renderedText: "text" })
    .returning();
  await db.insert(s.preferences).values({ userId });
  await db.insert(s.profileEmbeddings).values({
    userId,
    profileId,
    kind: "experience",
    model: "test",
    contentHash: "h",
    embedding: embedding(),
  });
  await db
    .insert(s.matches)
    .values({ userId, jobId, band: "good", score: 0.7, scoreBreakdown: {}, profileHash: "p" });
  await db.insert(s.matchFeedback).values({ userId, jobId, kind: "dismiss", dismissReason: "location" });
  await db.insert(s.savedJobs).values({ userId, jobId });
  const [application] = await db
    .insert(s.applications)
    .values({ userId, jobId, jobTitle: "Engineer", companyName: "Acme", resumeVersionId: version?.id })
    .returning();
  await db.insert(s.tailoringSuggestions).values({
    userId,
    jobId,
    applicationId: application?.id,
    type: "reword",
    targetRef: "experience.0.bullets.0",
    before: "a",
    after: "b",
    rationale: "r",
  });
  await db.insert(s.jobRuns).values({ kind: "resume_extract", userId });
  await db.insert(s.llmCache).values({ key: `k-${userId}`, model: "m", purpose: "p", response: {}, userId });
  return { profileId };
}

async function asAnon<T>(db: Database, fn: (tx: Transaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role anon`);
    return fn(tx);
  });
}

/** Drizzle wraps driver errors, so the Postgres message may be on `cause`. */
async function expectRlsViolation(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  const messages: string[] = [];
  for (let e: unknown = error; e instanceof Error; e = e.cause) messages.push(e.message);
  expect(messages.join(" | ")).toMatch(/row-level security/);
}

const rowCount = (result: unknown): number => {
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? rows.length : 0;
};

describe("row level security", () => {
  let t: TestDb;
  let userA: string;
  let userB: string;
  let publicJobId: string;
  let privateJobOfA: string;
  let profileOfB: string;

  beforeAll(async () => {
    t = await createTestDb();
    userA = await createAuthUser(t.db, "a@example.test");
    userB = await createAuthUser(t.db, "b@example.test");
    publicJobId = await insertJob(t.db, null, "Backend Engineer");
    privateJobOfA = await insertJob(t.db, userA, "Pasted Job");
    await seedUser(t.db, userA, publicJobId);
    ({ profileId: profileOfB } = await seedUser(t.db, userB, publicJobId));
    await t.db.insert(s.jobRuns).values({ kind: "ingest" });
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  it("is enabled on every table in the public schema", async () => {
    const result = await t.db.execute(sql`
      select c.relname as name, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`);
    const tables = (result as unknown as { rows: { name: string; rls: boolean }[] }).rows;
    expect(tables.length).toBeGreaterThanOrEqual(26);
    expect(tables.filter((table) => !table.rls).map((table) => table.name)).toEqual([]);
  });

  it("scopes every policy on a user-owned table to auth.uid()", async () => {
    const result = await t.db.execute(sql`
      select p.tablename, p.policyname, coalesce(p.qual, '') as qual, coalesce(p.with_check, '') as with_check
      from pg_policies p
      where p.schemaname = 'public'
        and exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = p.tablename and c.column_name = 'user_id'
        )`);
    const policies = (result as unknown as { rows: { qual: string; with_check: string }[] }).rows;
    expect(policies.length).toBeGreaterThanOrEqual(OWN_ROW_TABLES.length);
    for (const policy of policies) {
      expect(policy.qual).toContain("auth.uid()");
      if (policy.with_check) expect(policy.with_check).toContain("auth.uid()");
    }
  });

  it("does not expose the security-definer auth trigger function to API roles", async () => {
    const result = await t.db.execute(sql`
      select
        has_function_privilege('anon', 'public.handle_auth_user_change()', 'execute') as anon,
        has_function_privilege('authenticated', 'public.handle_auth_user_change()', 'execute') as authed`);
    const [row] = (result as unknown as { rows: { anon: boolean; authed: boolean }[] }).rows;
    expect(row).toEqual({ anon: false, authed: false });
  });

  it("creates a public.users row for each auth user via trigger", async () => {
    const rows = await t.db.select().from(s.users);
    expect(rows.map((row) => row.email).sort()).toEqual(["a@example.test", "b@example.test"]);
  });

  describe.each(OWN_ROW_TABLES)("%s", (table) => {
    const tableSql = sql.identifier(table);

    it("returns only the signed-in user's rows", async () => {
      const result = await withUserContext(t.db, userA, (tx) =>
        tx.execute(sql`select user_id from ${tableSql}`),
      );
      const rows = (result as unknown as { rows: { user_id: string }[] }).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.user_id === userA)).toBe(true);
    });

    it("cannot update or delete another user's rows", async () => {
      const updated = await withUserContext(t.db, userA, (tx) =>
        tx.execute(sql`update ${tableSql} set user_id = user_id where user_id = ${userB} returning user_id`),
      );
      const deleted = await withUserContext(t.db, userA, (tx) =>
        tx.execute(sql`delete from ${tableSql} where user_id = ${userB} returning user_id`),
      );
      expect(rowCount(updated)).toBe(0);
      expect(rowCount(deleted)).toBe(0);
      const remaining = await t.db.execute(sql`select 1 from ${tableSql} where user_id = ${userB}`);
      expect(rowCount(remaining)).toBeGreaterThan(0);
    });

    it("cannot reassign its own rows to another user", async () => {
      await expectRlsViolation(
        withUserContext(t.db, userA, (tx) =>
          tx.execute(sql`update ${tableSql} set user_id = ${userB} where user_id = ${userA}`),
        ),
      );
    });

    it("is invisible to the anon role", async () => {
      const result = await asAnon(t.db, (tx) => tx.execute(sql`select 1 from ${tableSql}`));
      expect(rowCount(result)).toBe(0);
    });
  });

  it("rejects inserting a row owned by another user", async () => {
    await expectRlsViolation(
      withUserContext(t.db, userA, (tx) =>
        tx.insert(s.profileSkills).values({
          userId: userB,
          profileId: profileOfB,
          name: "Injected",
          normalizedName: "injected",
        }),
      ),
    );
  });

  it("lets a user read only their own users row", async () => {
    const rows = await withUserContext(t.db, userA, (tx) => tx.select().from(s.users));
    expect(rows.map((row) => row.id)).toEqual([userA]);
  });

  it("lets a user poll their own job runs but not system or other users' runs", async () => {
    const rows = await withUserContext(t.db, userA, (tx) => tx.select().from(s.jobRuns));
    expect(rows.length).toBe(1);
    expect(rows[0]?.userId).toBe(userA);
  });

  it("hides server-only tables from users, even rows tied to them", async () => {
    for (const table of ["llm_cache", "job_postings", "job_embeddings", "connector_cursors", "rate_limits"]) {
      const result = await withUserContext(t.db, userA, (tx) =>
        tx.execute(sql`select 1 from ${sql.identifier(table)}`),
      );
      expect(rowCount(result), table).toBe(0);
    }
  });

  it("shows public jobs to everyone and pasted jobs only to their owner", async () => {
    const seenByA = await withUserContext(t.db, userA, (tx) => tx.select({ id: s.jobs.id }).from(s.jobs));
    const seenByB = await withUserContext(t.db, userB, (tx) => tx.select({ id: s.jobs.id }).from(s.jobs));
    expect(seenByA.map((job) => job.id).sort()).toEqual([publicJobId, privateJobOfA].sort());
    expect(seenByB.map((job) => job.id)).toEqual([publicJobId]);

    const requirementsSeenByB = await withUserContext(t.db, userB, (tx) =>
      tx
        .select({ jobId: s.jobRequirements.jobId })
        .from(s.jobRequirements)
        .where(eq(s.jobRequirements.jobId, privateJobOfA)),
    );
    expect(requirementsSeenByB).toEqual([]);
  });

  it("does not let users write to shared job tables", async () => {
    await expect(
      withUserContext(t.db, userA, (tx) =>
        tx.update(s.jobs).set({ title: "Hijacked" }).where(eq(s.jobs.id, publicJobId)).returning(),
      ),
    ).resolves.toEqual([]);
  });

  it("refuses a non-UUID user id", async () => {
    await expect(withUserContext(t.db, "' or 1=1 --", async () => 1)).rejects.toThrow(/UUID/);
  });
});

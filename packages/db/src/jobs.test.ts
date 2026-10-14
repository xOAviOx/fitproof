import { cleanJobText, hardRequirementSchema, JOB_ANALYSIS_KIND, type VerifiedJob } from "@repo/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadJobEmbedding, loadProfileEmbedding, saveJobEmbedding, saveProfileEmbedding } from "./embeddings";
import { schema } from "./index";
import {
  cacheJobPage,
  createUserJob,
  GapResponseError,
  listUserJobs,
  loadCachedJobPage,
  loadJobForAnalysis,
  loadUserJob,
  loadUserJobStatus,
  markJobAnalysisFailed,
  recordGapResponse,
  requestJobAnalysis,
  saveJobAnalysis,
  saveMatch,
} from "./jobs";
import { loadProfile, saveProfile } from "./profile";
import { claimJobById, completeJob } from "./queue";
import { createAuthUser, createTestDb, type TestDb } from "./testing/pglite";
import {
  listApplications,
  removeApplication,
  saveToTracker,
  TrackerError,
  updateApplication,
} from "./tracker";

let test: TestDb;
let alice: string;
let bob: string;

const DESCRIPTION = cleanJobText(`Backend Engineer at Acme
Must know Node.js.
Kafka is a plus.
Graduates of 2026 only.
${"Build and run payment APIs for merchants across India. ".repeat(4)}`);

const VERIFIED: VerifiedJob = {
  title: "Backend Engineer",
  company: "Acme",
  locations: ["Bengaluru"],
  remoteType: "hybrid",
  employmentType: "full_time",
  seniority: "entry",
  roleFamily: "backend",
  salary: { min: 800000, max: 1200000, currency: "INR", period: "year" },
  requirements: [
    { type: "core_skill", text: "Node.js", quote: "Must know Node.js.", skill: "nodejs", eligibility: null },
    { type: "nice_to_have", text: "Kafka", quote: "Kafka is a plus.", skill: "kafka", eligibility: null },
    {
      type: "hard_eligibility",
      text: "2026 graduates",
      quote: "Graduates of 2026 only.",
      skill: null,
      eligibility: hardRequirementSchema.parse({
        kind: "graduation_batch",
        quote: "Graduates of 2026 only.",
        value: { years: [2026] },
      }),
    },
  ],
};

const newJob = (userId: string, description = DESCRIPTION) =>
  createUserJob(test.db, userId, {
    source: "user_paste",
    description,
    sourceUrl: null,
    title: null,
    company: null,
  });

const match = {
  band: "good" as const,
  score: 0.7,
  scoreBreakdown: { coreCoverage: 0.6 },
  explanation: null,
  explanationStatus: "fallback" as const,
  profileHash: "hash-1",
};

beforeAll(async () => {
  test = await createTestDb();
  alice = await createAuthUser(test.db);
  bob = await createAuthUser(test.db);
}, 30_000);
afterAll(async () => {
  await test.close();
});

describe("user-added jobs", () => {
  it("creates a private job and queues its analysis", async () => {
    const created = await newJob(alice);
    expect(created.created).toBe(true);
    const [run] = await test.db
      .select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.id, created.runId ?? ""));
    expect(run).toMatchObject({ kind: JOB_ANALYSIS_KIND, userId: alice, payload: { jobId: created.jobId } });
    const [job] = await test.db.select().from(schema.jobs).where(eq(schema.jobs.id, created.jobId));
    expect(job).toMatchObject({
      ownerUserId: alice,
      title: "Job you added",
      sourceName: "Pasted by you",
      requirementsStatus: "pending",
    });
  });

  it("reuses the same text for the same user, and requeues a failed analysis", async () => {
    const first = await newJob(alice);
    expect(first).toEqual({ jobId: first.jobId, runId: null, created: false });
    await markJobAnalysisFailed(test.db, first.jobId);
    const retried = await newJob(alice);
    expect(retried.created).toBe(false);
    expect(retried.runId).not.toBeNull();
    expect((await loadUserJobStatus(test.db, alice, first.jobId))?.requirements).toBe("pending");
    const other = await newJob(bob);
    expect(other.created).toBe(true);
    expect(other.jobId).not.toBe(first.jobId);
  });

  it("names URL jobs after their site", async () => {
    const created = await createUserJob(test.db, alice, {
      source: "user_url",
      description: `${DESCRIPTION}\nFrom the careers page.`,
      sourceUrl: "https://www.careers.example.com/jobs/1",
      title: "Platform Engineer",
      company: "Example",
    });
    const loaded = await loadUserJob(test.db, alice, created.jobId);
    expect(loaded?.job).toMatchObject({
      title: "Platform Engineer",
      companyName: "Example",
      sourceName: "careers.example.com",
      applyUrl: "https://www.careers.example.com/jobs/1",
    });
  });

  it("claims a specific run once", async () => {
    const { jobId } = await newJob(alice, `${DESCRIPTION}\nClaim test.`);
    const status = await loadUserJob(test.db, alice, jobId);
    const runId = status?.run?.id ?? "";
    expect((await claimJobById(test.db, runId))?.status).toBe("running");
    expect(await claimJobById(test.db, runId)).toBeNull();
    await completeJob(test.db, runId);
    expect((await loadUserJobStatus(test.db, alice, jobId))?.run).toBe("succeeded");
  });

  it("queues a re-check once, retries failed jobs, and only for the owner", async () => {
    const { jobId, runId } = await newJob(alice, `${DESCRIPTION}\nRe-check test.`);
    expect(await requestJobAnalysis(test.db, alice, jobId)).toEqual({ runId, created: false });
    expect(await requestJobAnalysis(test.db, bob, jobId)).toBeNull();
    await completeJob(test.db, runId ?? "");
    await markJobAnalysisFailed(test.db, jobId);
    const again = await requestJobAnalysis(test.db, alice, jobId);
    expect(again?.created).toBe(true);
    expect(await loadUserJobStatus(test.db, alice, jobId)).toMatchObject({
      requirements: "pending",
      runId: again?.runId,
      run: "queued",
    });
  });
});

describe("analysis and matches", () => {
  let jobId = "";
  let nodeId = "";
  let kafkaId = "";

  it("stores verified facts and requirements in order", async () => {
    jobId = (await newJob(alice, `${DESCRIPTION}\nAnalysis test.`)).jobId;
    const stored = await saveJobAnalysis(test.db, jobId, VERIFIED);
    expect(stored.map((item) => [item.type, item.skill])).toEqual([
      ["core_skill", "nodejs"],
      ["nice_to_have", "kafka"],
      ["hard_eligibility", null],
    ]);
    expect(stored[2]?.eligibility).toEqual(VERIFIED.requirements[2]?.eligibility);
    nodeId = stored[0]?.id ?? "";
    kafkaId = stored[1]?.id ?? "";
    const loaded = await loadJobForAnalysis(test.db, jobId);
    expect(loaded?.job).toMatchObject({
      title: "Backend Engineer",
      requirementsStatus: "ready",
      salaryMin: 800000,
      roleFamily: "backend",
    });
    expect(loaded?.requirements).toEqual(stored);
  });

  it("keeps jobs, requirements, and matches private to their owner", async () => {
    await saveMatch(test.db, alice, jobId, match);
    const own = await loadUserJob(test.db, alice, jobId);
    expect(own?.match).toMatchObject({ band: "good", profileHash: "hash-1" });
    expect(own?.requirements).toHaveLength(3);
    expect(await loadUserJob(test.db, bob, jobId)).toBeNull();
    expect(await loadUserJobStatus(test.db, bob, jobId)).toBeNull();
    expect((await listUserJobs(test.db, bob)).map((item) => item.id)).not.toContain(jobId);
    const listed = (await listUserJobs(test.db, alice)).find((item) => item.id === jobId);
    expect(listed).toMatchObject({ band: "good", saved: false, requirementsStatus: "ready" });

    await saveMatch(test.db, alice, jobId, { ...match, band: "strong" });
    expect((await loadUserJob(test.db, alice, jobId))?.match?.band).toBe("strong");
    await expect(
      test.db.select().from(schema.matches).where(eq(schema.matches.jobId, jobId)),
    ).resolves.toHaveLength(1);
  });

  it("adds a confirmed self-declared skill for 'I have this' and undoes it", async () => {
    const before = await loadProfile(test.db, alice);
    const result = await recordGapResponse(test.db, alice, {
      jobId,
      requirementId: kafkaId,
      response: "has_it",
    });
    expect(result.profileChanged).toBe(true);
    let profile = await loadProfile(test.db, alice);
    expect(profile.content.skills).toEqual([
      expect.objectContaining({
        name: "Kafka",
        tier: "self_declared",
        userConfirmed: true,
        sourceText: null,
      }),
    ]);
    expect(profile.profile?.updatedAt.getTime()).toBeGreaterThan(before.profile?.updatedAt.getTime() ?? 0);
    const [row] = await test.db
      .select()
      .from(schema.profileSkills)
      .where(eq(schema.profileSkills.userId, alice));
    expect(row?.origin).toBe("gap_prompt");
    expect((await loadUserJob(test.db, alice, jobId))?.gapResponses.get(kafkaId)).toBe("has_it");

    // Answering again doesn't duplicate the skill.
    expect(
      (await recordGapResponse(test.db, alice, { jobId, requirementId: kafkaId, response: "has_it" }))
        .profileChanged,
    ).toBe(false);

    await recordGapResponse(test.db, alice, { jobId, requirementId: kafkaId, response: "does_not_have" });
    profile = await loadProfile(test.db, alice);
    expect(profile.content.skills).toEqual([]);
    expect((await loadUserJob(test.db, alice, jobId))?.gapResponses.get(kafkaId)).toBe("does_not_have");
    const feedback = await test.db
      .select()
      .from(schema.matchFeedback)
      .where(eq(schema.matchFeedback.jobId, jobId));
    expect(feedback).toHaveLength(1);
  });

  it("confirms an existing draft skill instead of duplicating it, and keeps origins on save", async () => {
    let profile = await loadProfile(test.db, alice);
    await saveProfile(test.db, alice, {
      content: {
        ...profile.content,
        skills: [{ name: "NodeJS", tier: "self_declared", sourceText: null, userConfirmed: false }],
      },
      revision: profile.profile?.updatedAt.toISOString() ?? null,
      confirm: false,
    });
    await recordGapResponse(test.db, alice, { jobId, requirementId: nodeId, response: "has_it" });
    await recordGapResponse(test.db, alice, { jobId, requirementId: kafkaId, response: "has_it" });
    profile = await loadProfile(test.db, alice);
    expect(profile.content.skills.map((skill) => [skill.name, skill.userConfirmed])).toEqual([
      ["NodeJS", true],
      ["Kafka", true],
    ]);
    await saveProfile(test.db, alice, {
      content: profile.content,
      revision: profile.profile?.updatedAt.toISOString() ?? null,
      confirm: true,
    });
    const rows = await test.db
      .select()
      .from(schema.profileSkills)
      .where(eq(schema.profileSkills.userId, alice));
    expect(Object.fromEntries(rows.map((row) => [row.name, row.origin]))).toEqual({
      NodeJS: "manual",
      Kafka: "gap_prompt",
    });
  });

  it("rejects answers for other users' jobs and for non-skill requirements", async () => {
    await expect(
      recordGapResponse(test.db, bob, { jobId, requirementId: kafkaId, response: "has_it" }),
    ).rejects.toBeInstanceOf(GapResponseError);
    const loaded = await loadJobForAnalysis(test.db, jobId);
    const eligibilityId = loaded?.requirements[2]?.id ?? "";
    await expect(
      recordGapResponse(test.db, alice, { jobId, requirementId: eligibilityId, response: "has_it" }),
    ).rejects.toBeInstanceOf(GapResponseError);
  });

  it("caches embeddings by model and content hash", async () => {
    const vector = Array.from({ length: 768 }, (_, i) => (i % 5) / 5);
    await saveJobEmbedding(test.db, { jobId, model: "m1", contentHash: "c1", embedding: vector });
    expect(await loadJobEmbedding(test.db, jobId, "m1", "c1")).toEqual(vector);
    expect(await loadJobEmbedding(test.db, jobId, "m1", "c2")).toBeNull();
    const profileId = (await loadProfile(test.db, alice)).profile?.id ?? "";
    const input = { profileId, kind: "experience", model: "m1", contentHash: "p1" };
    await saveProfileEmbedding(test.db, alice, { ...input, embedding: vector });
    expect(await loadProfileEmbedding(test.db, alice, input)).toEqual(vector);
    expect(await loadProfileEmbedding(test.db, bob, input)).toBeNull();
  });

  it("saves to the tracker once, edits with a revision, and isolates users", async () => {
    const saved = await saveToTracker(test.db, alice, jobId);
    expect(saved).toMatchObject({ status: "saved", jobTitle: "Backend Engineer", companyName: "Acme" });
    expect((await saveToTracker(test.db, alice, jobId)).id).toBe(saved.id);
    await expect(saveToTracker(test.db, bob, jobId)).rejects.toBeInstanceOf(TrackerError);
    expect((await loadUserJob(test.db, alice, jobId))?.application?.id).toBe(saved.id);
    expect((await listUserJobs(test.db, alice)).find((item) => item.id === jobId)?.saved).toBe(true);

    const [entry] = await listApplications(test.db, alice);
    expect(entry).toMatchObject({ id: saved.id, band: "strong", jobAvailable: true, jobClosedAt: null });
    expect(await listApplications(test.db, bob)).toEqual([]);

    const update = { status: "applied" as const, notes: "Referred by Priya", nextActionAt: "2026-11-01" };
    const updated = await updateApplication(test.db, alice, saved.id, {
      ...update,
      revision: saved.updatedAt.toISOString(),
    });
    expect(updated).toMatchObject({ status: "applied", notes: "Referred by Priya" });
    expect(updated?.appliedAt).toBeInstanceOf(Date);
    expect(updated?.nextActionAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    await expect(
      updateApplication(test.db, alice, saved.id, { ...update, revision: saved.updatedAt.toISOString() }),
    ).rejects.toThrow(/another tab/);
    await expect(
      updateApplication(test.db, bob, saved.id, {
        ...update,
        revision: updated?.updatedAt.toISOString() ?? "",
      }),
    ).rejects.toBeInstanceOf(TrackerError);

    expect(await removeApplication(test.db, bob, saved.id)).toBe(false);
    expect(await removeApplication(test.db, alice, saved.id)).toBe(true);
    expect(await listApplications(test.db, alice)).toEqual([]);
    const savedRows = await test.db.select().from(schema.savedJobs).where(eq(schema.savedJobs.jobId, jobId));
    expect(savedRows).toEqual([]);
  });
});

describe("fetched page cache", () => {
  it("stores pages by requested URL and expires them", async () => {
    const url = "https://jobs.example.com/123";
    expect(await loadCachedJobPage(test.db, url)).toBeNull();
    const page = {
      url: `${url}?ref=x`,
      title: "Analyst",
      company: null,
      text: DESCRIPTION,
      method: "json_ld",
    };
    await cacheJobPage(test.db, url, page);
    expect(await loadCachedJobPage(test.db, url)).toEqual(page);
    await cacheJobPage(test.db, url, { ...page, title: "Data Analyst" });
    expect((await loadCachedJobPage(test.db, url))?.title).toBe("Data Analyst");
    await test.db
      .update(schema.jobPostings)
      .set({ lastSeenAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(schema.jobPostings.source, "user_url"));
    expect(await loadCachedJobPage(test.db, url)).toBeNull();
  });
});

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimNextJob, completeJob, enqueueJob, failJob, trackRun } from "./queue";
import { jobRuns } from "./schema";
import { createTestDb, type TestDb } from "./testing/pglite";

describe("job queue", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(async () => {
    await t.db.delete(jobRuns);
  });

  const reload = async (id: string) => {
    const [row] = await t.db.select().from(jobRuns).where(eq(jobRuns.id, id));
    if (!row) throw new Error("missing run");
    return row;
  };

  const makeDueNow = (id: string) =>
    t.db.update(jobRuns).set({ scheduledAt: sql`now() - interval '1 second'` }).where(eq(jobRuns.id, id));

  it("leases a due job exactly once", async () => {
    const queued = await enqueueJob(t.db, { kind: "resume_extract", payload: { fileId: "f1" } });
    const claimed = await claimNextJob(t.db, { kinds: ["resume_extract"] });
    expect(claimed?.id).toBe(queued.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.lockedUntil).not.toBeNull();
    expect(await claimNextJob(t.db, { kinds: ["resume_extract"] })).toBeNull();
  });

  it("only claims the requested kinds and skips future jobs", async () => {
    await enqueueJob(t.db, { kind: "ingest" });
    await enqueueJob(t.db, { kind: "resume_extract", scheduledAt: new Date(Date.now() + 60_000) });
    expect(await claimNextJob(t.db, { kinds: ["resume_extract"] })).toBeNull();
    expect(await claimNextJob(t.db, { kinds: [] })).toBeNull();
  });

  it("marks a completed job as succeeded with its result", async () => {
    const queued = await enqueueJob(t.db, { kind: "k" });
    await claimNextJob(t.db, { kinds: ["k"] });
    await completeJob(t.db, queued.id, { processed: 3 });
    const row = await reload(queued.id);
    expect(row.status).toBe("succeeded");
    expect(row.result).toEqual({ processed: 3 });
    expect(row.finishedAt).not.toBeNull();
  });

  it("retries with backoff, then fails after the last attempt", async () => {
    const queued = await enqueueJob(t.db, { kind: "k", maxAttempts: 2 });

    const first = await claimNextJob(t.db, { kinds: ["k"] });
    if (!first) throw new Error("expected a claim");
    await expect(failJob(t.db, first, "boom 1")).resolves.toEqual({ retrying: true, delaySeconds: 30 });
    expect((await reload(queued.id)).status).toBe("queued");
    expect(await claimNextJob(t.db, { kinds: ["k"] })).toBeNull();

    await makeDueNow(queued.id);
    const second = await claimNextJob(t.db, { kinds: ["k"] });
    expect(second?.attempts).toBe(2);
    if (!second) throw new Error("expected a claim");
    await expect(failJob(t.db, second, "boom 2")).resolves.toEqual({ retrying: false });
    const row = await reload(queued.id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("boom 2");
  });

  it("reclaims a job whose worker died, and fails it once attempts run out", async () => {
    const queued = await enqueueJob(t.db, { kind: "k", maxAttempts: 2 });
    await claimNextJob(t.db, { kinds: ["k"] });
    const expireLease = () =>
      t.db
        .update(jobRuns)
        .set({ lockedUntil: sql`now() - interval '1 second'` })
        .where(eq(jobRuns.id, queued.id));

    await expireLease();
    const reclaimed = await claimNextJob(t.db, { kinds: ["k"] });
    expect(reclaimed?.attempts).toBe(2);

    await expireLease();
    expect(await claimNextJob(t.db, { kinds: ["k"] })).toBeNull();
    const row = await reload(queued.id);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/Lease expired/);
  });

  it("records tracked runs, including failures", async () => {
    const ok = await trackRun(t.db, "selftest", async () => ({ ok: true }));
    expect((await reload(ok.run.id)).status).toBe("succeeded");

    await expect(
      trackRun(t.db, "ingest", async () => {
        throw new Error("connector down");
      }),
    ).rejects.toThrow("connector down");
    const [failed] = await t.db.select().from(jobRuns).where(eq(jobRuns.kind, "ingest"));
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("connector down");
  });
});

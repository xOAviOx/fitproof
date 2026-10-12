import { schema } from "@repo/db";
import { createTestDb, type TestDb } from "@repo/db/testing";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { selftest } from "./selftest";

describe("selftest", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  it("records a succeeded selftest run", async () => {
    const runId = await selftest(t.db, pino({ level: "silent" }));
    const runs = await t.db.select().from(schema.jobRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: runId, kind: "selftest", status: "succeeded", result: { ok: true } });
  });
});

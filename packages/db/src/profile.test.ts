import { randomUUID } from "node:crypto";
import { emptyProfile, type ProfileContent, RESUME_MIME_TYPES } from "@repo/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "./index";
import { applyExtractedProfile, loadProfile, registerResumeUpload, saveProfile } from "./profile";
import { consumeRateLimit } from "./rate-limit";
import { createAuthUser, createTestDb, type TestDb } from "./testing/pglite";

let test: TestDb;
let user: string;
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing test fixture value");
  return value;
}
const draft = (): ProfileContent => ({
  ...emptyProfile(),
  skills: [{ name: "SQL", tier: "self_declared", sourceText: "Skills: SQL", userConfirmed: false }],
});
async function upload(userId = user) {
  const id = randomUUID();
  const run = await registerResumeUpload(test.db, userId, {
    id,
    userId,
    storagePath: `${userId}/${id}.pdf`,
    originalFilename: "resume.pdf",
    mimeType: RESUME_MIME_TYPES.pdf,
    sizeBytes: 1000,
    sha256: id,
  });
  return { id, run };
}

beforeAll(async () => {
  test = await createTestDb();
  user = await createAuthUser(test.db);
}, 30_000);
afterAll(async () => {
  await test.close();
});

describe("profile persistence", () => {
  it("atomically registers an upload and queues extraction", async () => {
    const { id, run } = await upload();
    expect(run.payload).toEqual({ resumeFileId: id });
    const result = await loadProfile(test.db, user);
    expect(result.profile?.sourceResumeFileId).toBe(id);
    expect(result.resume?.status).toBe("uploaded");
    await expect(
      saveProfile(test.db, user, {
        content: draft(),
        revision: result.profile?.updatedAt.toISOString() ?? null,
        confirm: false,
      }),
    ).rejects.toThrow(/Wait/);
    await applyExtractedProfile(test.db, user, id, "Skills: SQL", draft());
  });
  it("keeps verified quotes, confirms entries, and clears quotes on edits", async () => {
    let result = await loadProfile(test.db, user);
    required(result.content.skills[0]).userConfirmed = true;
    await saveProfile(test.db, user, {
      content: result.content,
      revision: required(result.profile).updatedAt.toISOString(),
      confirm: true,
    });
    result = await loadProfile(test.db, user);
    expect(result.profile?.status).toBe("confirmed");
    expect(result.content.skills[0]?.sourceText).toBe("Skills: SQL");
    required(result.content.skills[0]).name = "Rust";
    required(result.content.skills[0]).sourceText = "Invented quote";
    required(result.content.skills[0]).tier = "paid_work";
    await saveProfile(test.db, user, {
      content: result.content,
      revision: required(result.profile).updatedAt.toISOString(),
      confirm: false,
    });
    const changed = await loadProfile(test.db, user);
    expect(changed.content.skills[0]?.sourceText).toBeNull();
    expect(changed.content.skills[0]?.tier).toBe("self_declared");
  });
  it("rejects stale saves and foreign entry IDs", async () => {
    const result = await loadProfile(test.db, user);
    await expect(
      saveProfile(test.db, user, {
        content: result.content,
        revision: "2000-01-01T00:00:00.000Z",
        confirm: false,
      }),
    ).rejects.toThrow(/another tab/);
    required(result.content.skills[0]).id = randomUUID();
    await expect(
      saveProfile(test.db, user, {
        content: result.content,
        revision: required(result.profile).updatedAt.toISOString(),
        confirm: false,
      }),
    ).rejects.toThrow(/another tab/);
  });
  it("requires per-entry confirmation and at least one evidence entry", async () => {
    await expect(
      saveProfile(test.db, user, { content: draft(), revision: null, confirm: true }),
    ).rejects.toThrow(/every evidence/);
    await expect(
      saveProfile(test.db, user, { content: emptyProfile(), revision: null, confirm: true }),
    ).rejects.toThrow(/every evidence/);
  });
  it("late extraction cannot overwrite a new upload; the new extraction replaces the draft", async () => {
    const old = await upload();
    const latest = await upload();
    expect(await applyExtractedProfile(test.db, user, old.id, "Skills: SQL", draft())).toEqual({
      superseded: true,
    });
    expect((await loadProfile(test.db, user)).profile?.sourceResumeFileId).toBe(latest.id);
    const replacement = draft();
    required(replacement.skills[0]).name = "Python";
    required(replacement.skills[0]).sourceText = "Skills: Python";
    await applyExtractedProfile(test.db, user, latest.id, "Skills: Python", replacement);
    expect((await loadProfile(test.db, user)).content.skills.map((row) => row.name)).toEqual(["Python"]);
  });
  it("does not expose or modify another user's profile", async () => {
    const other = await createAuthUser(test.db);
    const result = await loadProfile(test.db, other);
    expect(result.profile).toBeNull();
    expect(result.resume).toBeNull();
    expect(result.content.skills).toEqual([]);
    const uploaded = await upload(other);
    await applyExtractedProfile(test.db, other, uploaded.id, "Skills: SQL", draft());
    expect((await loadProfile(test.db, user)).content.skills[0]?.name).toBe("Python");
  });
  it("rolls queue insertion back when file persistence fails", async () => {
    const before = await test.db.select().from(schema.jobRuns);
    await expect(
      registerResumeUpload(test.db, user, {
        id: randomUUID(),
        userId: user,
        storagePath: "duplicate",
        originalFilename: "test.pdf",
        mimeType: RESUME_MIME_TYPES.pdf,
        sizeBytes: 1,
        sha256: "x",
      }),
    ).resolves.toBeDefined();
    await expect(
      registerResumeUpload(test.db, user, {
        id: randomUUID(),
        userId: user,
        storagePath: "duplicate",
        originalFilename: "test.pdf",
        mimeType: RESUME_MIME_TYPES.pdf,
        sizeBytes: 1,
        sha256: "x",
      }),
    ).rejects.toThrow();
    expect(await test.db.select().from(schema.jobRuns)).toHaveLength(before.length + 1);
  });
});

describe("atomic fixed-window rate limits", () => {
  it("allows the budget, rejects extra calls, and resets in a new window", async () => {
    const now = new Date("2026-01-01T12:00:01Z");
    await consumeRateLimit(test.db, "test-upload", 2, 60, now);
    await consumeRateLimit(test.db, "test-upload", 2, 60, now);
    await expect(consumeRateLimit(test.db, "test-upload", 2, 60, now)).rejects.toMatchObject({
      retryAfterSeconds: 59,
    });
    await consumeRateLimit(test.db, "test-upload", 2, 60, new Date("2026-01-01T12:01:01Z"));
    expect(
      await test.db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, "test-upload")),
    ).toHaveLength(2);
  });
});

import { emptyPreferences, type Preferences } from "@repo/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "./index";
import { loadPreferences, PreferencesConflictError, savePreferences } from "./preferences";
import { createAuthUser, createTestDb, type TestDb } from "./testing/pglite";

let test: TestDb;
let user: string;
const complete = (): Preferences => ({
  desiredRoles: ["data_analyst", "backend"],
  employmentTypes: ["internship", "full_time"],
  remotePreference: "hybrid",
  locations: ["Bangalore", "Pune", "Remote"],
  willingToRelocate: false,
  minAnnualSalaryInr: 650_000,
  noticePeriodDays: 30,
  availableFrom: "2026-07-01",
  graduationYear: 2026,
  degree: "B.Tech / B.E.",
  branch: "Computer Science",
  scoreType: "cgpa",
  score: 8.25,
  scoreScale: 10,
  workAuthorization: "authorized",
});

beforeAll(async () => {
  test = await createTestDb();
  user = await createAuthUser(test.db);
}, 30_000);
afterAll(async () => {
  await test.close();
});

describe("preferences persistence", () => {
  it("returns nothing before the first save", async () => {
    expect(await loadPreferences(test.db, user)).toEqual({ preferences: null, revision: null });
  });
  it("persists every field, normalized, and returns a revision", async () => {
    const saved = await savePreferences(test.db, user, { preferences: complete(), revision: null });
    const loaded = await loadPreferences(test.db, user);
    expect(loaded).toEqual(saved);
    expect(loaded.preferences).toEqual({
      ...complete(),
      desiredRoles: ["backend", "data_analyst"],
      employmentTypes: ["full_time", "internship"],
      locations: ["Bengaluru", "Pune"],
    });
  });
  it("updates with the current revision and clears optional fields", async () => {
    const current = await loadPreferences(test.db, user);
    const next = {
      ...emptyPreferences(),
      desiredRoles: ["frontend"],
      employmentTypes: ["contract"],
      remotePreference: "remote",
    } satisfies Preferences;
    const saved = await savePreferences(test.db, user, { preferences: next, revision: current.revision });
    expect(saved.revision).not.toBe(current.revision);
    expect((await loadPreferences(test.db, user)).preferences).toEqual(next);
  });
  it("rejects stale revisions and a second first-save", async () => {
    await expect(
      savePreferences(test.db, user, { preferences: complete(), revision: "2000-01-01T00:00:00.000Z" }),
    ).rejects.toBeInstanceOf(PreferencesConflictError);
    await expect(
      savePreferences(test.db, user, { preferences: complete(), revision: null }),
    ).rejects.toBeInstanceOf(PreferencesConflictError);
  });
  it("validates input before writing", async () => {
    const before = await loadPreferences(test.db, user);
    await expect(
      savePreferences(test.db, user, {
        preferences: { ...complete(), desiredRoles: [], score: 11 },
        revision: before.revision,
      }),
    ).rejects.toThrow(/Choose at least one role/);
    expect(await loadPreferences(test.db, user)).toEqual(before);
  });
  it("keeps each user's preferences private", async () => {
    const other = await createAuthUser(test.db);
    expect(await loadPreferences(test.db, other)).toEqual({ preferences: null, revision: null });
    await savePreferences(test.db, other, { preferences: complete(), revision: null });
    expect((await loadPreferences(test.db, user)).preferences?.desiredRoles).toEqual(["frontend"]);
    const rows = await test.db.select({ userId: schema.preferences.userId }).from(schema.preferences);
    expect(rows.map((row) => row.userId).sort()).toEqual([user, other].sort());
  });
});

describe("eligibility vocabulary migration", () => {
  it("accepts the availability eligibility kind", async () => {
    const result = await test.db.execute(sql`select 'availability'::eligibility_kind::text as kind`);
    expect(JSON.stringify(result)).toContain("availability");
  });
});

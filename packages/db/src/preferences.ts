import {
  normalizePreferences,
  type Preferences,
  preferencesFieldsSchema,
  preferencesSchema,
} from "@repo/core";
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { withUserContext } from "./rls";
import { preferences } from "./schema";

export class PreferencesConflictError extends Error {
  constructor() {
    super("Your preferences changed in another tab. Reload before saving.");
  }
}

function fromRow(row: typeof preferences.$inferSelect): Preferences {
  return preferencesFieldsSchema.parse({
    desiredRoles: row.desiredRoles,
    employmentTypes: row.employmentTypes.filter((type) => type !== "unknown"),
    remotePreference: row.remotePreference,
    locations: row.locations,
    willingToRelocate: row.willingToRelocate,
    minAnnualSalaryInr: row.minAnnualSalaryInr,
    noticePeriodDays: row.noticePeriodDays,
    availableFrom: row.availableFrom,
    graduationYear: row.graduationYear,
    degree: row.degree,
    branch: row.branch,
    scoreType: row.scoreType,
    score: row.score === null ? null : Number(row.score),
    scoreScale: row.scoreScale === null ? null : Number(row.scoreScale),
    workAuthorization: row.workAuthorization,
  });
}

export async function loadPreferences(db: Database, userId: string) {
  return withUserContext(db, userId, async (tx) => {
    const [row] = await tx.select().from(preferences).limit(1);
    return row
      ? { preferences: fromRow(row), revision: row.updatedAt.toISOString() }
      : { preferences: null, revision: null };
  });
}

/** `revision` is the `updatedAt` the editor loaded (null for a first save); stale saves are rejected. */
export async function savePreferences(
  db: Database,
  userId: string,
  input: { preferences: Preferences; revision: string | null },
) {
  const values = normalizePreferences(preferencesSchema.parse(input.preferences));
  const columns = {
    ...values,
    score: values.score?.toString() ?? null,
    scoreScale: values.scoreScale?.toString() ?? null,
    updatedAt: new Date(),
  };
  return withUserContext(db, userId, async (tx) => {
    const [existing] = await tx
      .select({ id: preferences.id, updatedAt: preferences.updatedAt })
      .from(preferences)
      .limit(1)
      .for("update");
    if ((existing?.updatedAt.toISOString() ?? null) !== input.revision) throw new PreferencesConflictError();
    const [saved] = existing
      ? await tx.update(preferences).set(columns).where(eq(preferences.id, existing.id)).returning()
      : await tx
          .insert(preferences)
          .values({ ...columns, userId })
          .onConflictDoNothing()
          .returning();
    if (!saved) throw new PreferencesConflictError();
    return { preferences: fromRow(saved), revision: saved.updatedAt.toISOString() };
  });
}

"use server";

import { type PreferenceField, preferenceErrors, preferencesSchema } from "@repo/core";
import { consumeRateLimit, PreferencesConflictError, RateLimitError, savePreferences } from "@repo/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { databaseErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type PreferencesActionState =
  | { status: "idle" }
  | { status: "success"; message: string; revision: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<PreferenceField, string>> };

const revisionSchema = z.iso.datetime().nullable();

export async function savePreferencesAction(
  _previous: PreferencesActionState,
  formData: FormData,
): Promise<PreferencesActionState> {
  const user = await requireUser();
  let raw: unknown;
  try {
    const json = String(formData.get("preferences") ?? "");
    if (json.length > 20_000) throw new Error("Too large");
    raw = JSON.parse(json);
  } catch {
    return { status: "error", message: "Invalid preferences data. Reload and try again." };
  }
  const revision = revisionSchema.safeParse(formData.get("revision") || null);
  if (!revision.success)
    return { status: "error", message: "Invalid preferences data. Reload and try again." };
  const parsed = preferencesSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: preferenceErrors(raw) };
  }
  try {
    await consumeRateLimit(getDb(), `preferences-save:${user.id}`, 30, 60);
    const saved = await savePreferences(getDb(), user.id, {
      preferences: parsed.data,
      revision: revision.data,
    });
    revalidatePath("/preferences");
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return {
      status: "success",
      message: "Preferences saved. Your filters now use these values.",
      revision: saved.revision,
    };
  } catch (error) {
    if (error instanceof PreferencesConflictError || error instanceof RateLimitError) {
      return { status: "error", message: error.message };
    }
    logger.warn({ userId: user.id, code: databaseErrorCode(error) }, "preferences save failed");
    return { status: "error", message: "Couldn't save your preferences. Try again in a moment." };
  }
}

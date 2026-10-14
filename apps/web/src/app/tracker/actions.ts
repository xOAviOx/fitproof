"use server";

import { applicationUpdateSchema } from "@repo/core";
import {
  consumeRateLimit,
  RateLimitError,
  removeApplication,
  TrackerError,
  updateApplication,
} from "@repo/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { databaseErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type TrackerActionState = { status: "idle" } | { status: "success" | "error"; message: string };

const updateSchema = applicationUpdateSchema.extend({ id: z.uuid(), revision: z.iso.datetime() });

export async function updateApplicationAction(
  _previous: TrackerActionState,
  formData: FormData,
): Promise<TrackerActionState> {
  const user = await requireUser();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    revision: formData.get("revision"),
    status: formData.get("status"),
    notes: formData.get("notes") ?? "",
    nextActionAt: formData.get("nextActionAt") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the fields." };
  }
  const { id, ...update } = parsed.data;
  try {
    await consumeRateLimit(getDb(), `tracker-write:${user.id}`, 60, 60);
    await updateApplication(getDb(), user.id, id, update);
    revalidatePath("/tracker");
    return { status: "success", message: "Saved." };
  } catch (error) {
    if (error instanceof TrackerError || error instanceof RateLimitError) {
      return { status: "error", message: error.message };
    }
    logger.warn({ userId: user.id, code: databaseErrorCode(error) }, "tracker update failed");
    return { status: "error", message: "We couldn't save this entry. Try again in a moment." };
  }
}

export async function removeApplicationAction(
  _previous: TrackerActionState,
  formData: FormData,
): Promise<TrackerActionState> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "Reload the page and try again." };
  try {
    await consumeRateLimit(getDb(), `tracker-write:${user.id}`, 60, 60);
    await removeApplication(getDb(), user.id, id.data);
    revalidatePath("/tracker");
    revalidatePath("/jobs", "layout");
    return { status: "success", message: "Removed from your tracker." };
  } catch (error) {
    if (error instanceof RateLimitError) return { status: "error", message: error.message };
    logger.warn({ userId: user.id, code: databaseErrorCode(error) }, "tracker removal failed");
    return { status: "error", message: "We couldn't remove this entry. Try again in a moment." };
  }
}

"use server";

import { createHash, randomUUID } from "node:crypto";
import { profileContentSchema, ResumeInputError, validateResumeFile } from "@repo/core";
import {
  consumeRateLimit,
  ProfileConflictError,
  RateLimitError,
  registerResumeUpload,
  saveProfile,
} from "@repo/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { serverEnv } from "@/env";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { databaseErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getResumeStorage } from "@/lib/resume-storage";

export type ProfileActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export async function uploadResumeAction(
  _previous: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();
  if (!serverEnv().RESUME_UPLOADS_ENABLED) {
    return {
      status: "error",
      message: "Uploads aren't configured yet. You can build your profile manually below.",
    };
  }
  const file = formData.get("resume");
  if (!(file instanceof File)) return { status: "error", message: "Choose a PDF or DOCX résumé." };
  let path: string | undefined;
  let stored = false;
  try {
    const { extension, mimeType } = validateResumeFile(file);
    await consumeRateLimit(getDb(), `resume-upload:${user.id}`, 5, 3600);
    const id = randomUUID();
    path = `${user.id}/${id}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const prefix = Buffer.from(bytes.subarray(0, 5));
    if (
      (extension === "pdf" && prefix.toString() !== "%PDF-") ||
      (extension === "docx" && (prefix.length < 4 || prefix.readUInt32LE(0) !== 0x04034b50))
    ) {
      throw new ResumeInputError("The file contents don't match its format. Export a fresh PDF or DOCX.");
    }
    await getResumeStorage().put(path, bytes, mimeType);
    stored = true;
    await registerResumeUpload(getDb(), user.id, {
      id,
      userId: user.id,
      storagePath: path,
      originalFilename:
        Array.from(file.name)
          .filter((character) => character.charCodeAt(0) >= 32 && character !== "/" && character !== "\\")
          .join("")
          .slice(0, 255) || `resume.${extension}`,
      mimeType,
      sizeBytes: file.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    revalidatePath("/profile");
    revalidatePath("/dashboard");
    return {
      status: "success",
      message: "Résumé queued. You can leave this page and come back when processing finishes.",
    };
  } catch (error) {
    if (stored && path) {
      try {
        await getResumeStorage().remove(path);
      } catch {
        logger.warn({ userId: user.id }, "orphan résumé cleanup needs operator attention");
      }
    }
    if (error instanceof ResumeInputError || error instanceof RateLimitError) {
      return { status: "error", message: error.message };
    }
    logger.warn(
      { userId: user.id, code: databaseErrorCode(error), stage: stored ? "registration" : "storage" },
      "résumé upload failed",
    );
    return { status: "error", message: "We couldn't queue this résumé. Try again in a moment." };
  }
}

const saveSchema = z.object({
  revision: z.iso.datetime().nullable(),
  confirm: z.boolean(),
  content: profileContentSchema,
});

export async function saveProfileAction(
  _previous: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();
  let raw: unknown;
  try {
    const json = String(formData.get("content") ?? "");
    if (json.length > 200_000) throw new Error("Too large");
    raw = JSON.parse(json);
  } catch {
    return { status: "error", message: "Invalid profile data. Reload and try again." };
  }
  const parsed = saveSchema.safeParse({
    content: raw,
    revision: formData.get("revision") || null,
    confirm: formData.get("intent") === "confirm",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "error",
      message: `${issue?.path.join(".") ?? "Profile"}: ${issue?.message ?? "Check the fields."}`,
    };
  }
  try {
    await consumeRateLimit(getDb(), `profile-save:${user.id}`, 30, 60);
    await saveProfile(getDb(), user.id, parsed.data);
    revalidatePath("/profile");
    revalidatePath("/dashboard");
    return {
      status: "success",
      message: parsed.data.confirm
        ? "Profile confirmed. Your evidence is ready for matching."
        : "Draft saved.",
    };
  } catch (error) {
    if (error instanceof ProfileConflictError || error instanceof RateLimitError) {
      return { status: "error", message: error.message };
    }
    logger.warn({ userId: user.id, code: databaseErrorCode(error) }, "profile save failed");
    return {
      status: "error",
      message: "Couldn't save. Confirm every entry, check your fields, and wait for any upload to finish.",
    };
  }
}

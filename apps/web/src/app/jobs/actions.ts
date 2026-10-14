"use server";

import { refreshMatch } from "@repo/analysis";
import { fetchJobPage, JobPageError } from "@repo/connectors";
import { GAP_RESPONSES, jobTextSchema, jobUrlSchema } from "@repo/core";
import {
  type CachedJobPage,
  cacheJobPage,
  consumeRateLimit,
  createUserJob,
  GapResponseError,
  loadCachedJobPage,
  RateLimitError,
  recordGapResponse,
  requestJobAnalysis,
  saveToTracker,
  TrackerError,
} from "@repo/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { analyzeInBackground, jobFetchOptions } from "@/lib/analysis";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { databaseErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type AddJobState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      /** Set when a link couldn't be read: the form switches to paste with the link kept. */
      pasteInstead?: { url: string };
    };
export type ActionState = { status: "idle" } | { status: "success" | "error"; message: string };

const waitMessage = (error: RateLimitError, what: string) => {
  const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
  const wait =
    minutes >= 90 ? `${Math.ceil(minutes / 60)} hours` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `You've ${what} a lot recently. Try again in about ${wait}.`;
};

const optionalName = z
  .string()
  .trim()
  .max(200, "Keep the title and company under 200 characters.")
  .transform((value) => value || null);
const pasteSchema = z.object({
  text: jobTextSchema,
  title: optionalName,
  company: optionalName,
  sourceUrl: z.preprocess((value) => (value === "" ? null : value), jobUrlSchema.nullable()),
});
const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

async function limitJobAdds(userId: string) {
  await consumeRateLimit(getDb(), `job-add:${userId}`, 10, 3600);
  await consumeRateLimit(getDb(), `job-add-day:${userId}`, 30, 86400);
}

async function readLink(userId: string, url: string): Promise<CachedJobPage> {
  const cached = await loadCachedJobPage(getDb(), url);
  if (cached) return cached;
  await consumeRateLimit(getDb(), `job-fetch:${userId}`, 10, 3600);
  const page = await fetchJobPage(url, jobFetchOptions());
  const result = {
    url: page.url,
    title: page.title,
    company: page.company,
    text: page.text,
    method: page.method,
  };
  await cacheJobPage(getDb(), url, result);
  return result;
}

export async function addJobAction(_previous: AddJobState, formData: FormData): Promise<AddJobState> {
  const user = await requireUser();
  const mode = field(formData, "mode") === "link" ? "link" : "paste";
  let jobId: string;
  try {
    let created: Awaited<ReturnType<typeof createUserJob>>;
    if (mode === "link") {
      const url = jobUrlSchema.safeParse(field(formData, "url"));
      if (!url.success)
        return { status: "error", message: url.error.issues[0]?.message ?? "Check the link." };
      await limitJobAdds(user.id);
      let page: CachedJobPage;
      try {
        page = await readLink(user.id, url.data);
      } catch (error) {
        if (error instanceof RateLimitError) throw error;
        if (!(error instanceof JobPageError)) {
          logger.warn({ userId: user.id, code: databaseErrorCode(error) }, "reading a job link failed");
        }
        return {
          status: "error",
          message:
            error instanceof JobPageError
              ? error.message
              : "We couldn't read that page. Copy the job description and paste it instead.",
          pasteInstead: { url: url.data },
        };
      }
      const text = jobTextSchema.safeParse(page.text);
      if (!text.success) {
        return {
          status: "error",
          message: "We couldn't find enough of the job description on that page. Paste it instead.",
          pasteInstead: { url: url.data },
        };
      }
      created = await createUserJob(getDb(), user.id, {
        source: "user_url",
        description: text.data,
        sourceUrl: page.url,
        title: page.title,
        company: page.company,
      });
    } else {
      const parsed = pasteSchema.safeParse({
        text: field(formData, "text"),
        title: field(formData, "title"),
        company: field(formData, "company"),
        sourceUrl: field(formData, "sourceUrl"),
      });
      if (!parsed.success) {
        return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the fields." };
      }
      await limitJobAdds(user.id);
      created = await createUserJob(getDb(), user.id, {
        source: "user_paste",
        description: parsed.data.text,
        sourceUrl: parsed.data.sourceUrl,
        title: parsed.data.title,
        company: parsed.data.company,
      });
    }
    if (created.runId) analyzeInBackground(created.runId);
    jobId = created.jobId;
  } catch (error) {
    if (error instanceof RateLimitError)
      return { status: "error", message: waitMessage(error, "added jobs") };
    logger.warn({ userId: user.id, mode, code: databaseErrorCode(error) }, "adding a job failed");
    return { status: "error", message: "We couldn't add this job. Try again in a moment." };
  }
  revalidatePath("/jobs");
  redirect(`/jobs/${jobId}`);
}

const idSchema = z.uuid();
const gapSchema = z.object({
  jobId: z.uuid(),
  requirementId: z.uuid(),
  response: z.enum(GAP_RESPONSES),
});

export async function answerGapAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = gapSchema.safeParse({
    jobId: formData.get("jobId"),
    requirementId: formData.get("requirementId"),
    response: formData.get("response"),
  });
  if (!parsed.success) return { status: "error", message: "Reload the page and try again." };
  try {
    await consumeRateLimit(getDb(), `gap-answer:${user.id}`, 60, 3600);
    const { profileChanged } = await recordGapResponse(getDb(), user.id, parsed.data);
    if (profileChanged) await refreshMatch(getDb(), { userId: user.id, jobId: parsed.data.jobId });
    revalidatePath(`/jobs/${parsed.data.jobId}`);
    revalidatePath("/jobs");
    if (profileChanged) revalidatePath("/profile");
    const has = parsed.data.response === "has_it";
    return {
      status: "success",
      message: has
        ? profileChanged
          ? "Added to your profile as a self-declared skill. The match is updated."
          : "Noted. It's already in your profile."
        : profileChanged
          ? "Removed the skill you added here. The match is updated."
          : "Noted. This stays a gap.",
    };
  } catch (error) {
    if (error instanceof GapResponseError) return { status: "error", message: error.message };
    if (error instanceof RateLimitError) return { status: "error", message: waitMessage(error, "answered") };
    logger.warn({ userId: user.id, code: databaseErrorCode(error) }, "gap answer failed");
    return { status: "error", message: "We couldn't save your answer. Try again in a moment." };
  }
}

export async function recheckJobAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const jobId = idSchema.safeParse(formData.get("jobId"));
  if (!jobId.success) return { status: "error", message: "Reload the page and try again." };
  try {
    await consumeRateLimit(getDb(), `job-recheck:${user.id}`, 10, 3600);
    await consumeRateLimit(getDb(), `job-recheck-day:${user.id}`, 30, 86400);
    const queued = await requestJobAnalysis(getDb(), user.id, jobId.data);
    if (!queued) return { status: "error", message: "That job is no longer available." };
    if (queued.created) analyzeInBackground(queued.runId);
    revalidatePath(`/jobs/${jobId.data}`);
    return { status: "success", message: "Checking again. This page updates when it's done." };
  } catch (error) {
    if (error instanceof RateLimitError)
      return { status: "error", message: waitMessage(error, "re-checked jobs") };
    logger.warn({ userId: user.id, code: databaseErrorCode(error) }, "job re-check failed");
    return { status: "error", message: "We couldn't start a new check. Try again in a moment." };
  }
}

export async function saveJobAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const jobId = idSchema.safeParse(formData.get("jobId"));
  if (!jobId.success) return { status: "error", message: "Reload the page and try again." };
  try {
    await consumeRateLimit(getDb(), `tracker-write:${user.id}`, 60, 60);
    await saveToTracker(getDb(), user.id, jobId.data);
    revalidatePath(`/jobs/${jobId.data}`);
    revalidatePath("/jobs");
    revalidatePath("/tracker");
    return { status: "success", message: "Saved to your tracker." };
  } catch (error) {
    if (error instanceof TrackerError || error instanceof RateLimitError) {
      return { status: "error", message: error.message };
    }
    logger.warn({ userId: user.id, code: databaseErrorCode(error) }, "saving to tracker failed");
    return { status: "error", message: "We couldn't save this job. Try again in a moment." };
  }
}

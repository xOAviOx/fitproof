import {
  hasEvidence,
  RESUME_JOB_KIND,
  ResumeInputError,
  redactResume,
  verifyExtractedProfile,
} from "@repo/core";
import {
  applyExtractedProfile,
  claimNextJob,
  completeJob,
  type Database,
  failJob,
  RateLimitError,
  schema,
  withUserContext,
} from "@repo/db";
import type { ProfileExtractor } from "@repo/llm";
import type { ResumeStorage } from "@repo/storage";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { z } from "zod";
import { parseResume } from "../resume-parser";

const payloadSchema = z.object({ resumeFileId: z.uuid() });

export async function extractResumes(
  db: Database,
  logger: Logger,
  deps: {
    storage: ResumeStorage;
    extractor: ProfileExtractor;
    parse?: typeof parseResume;
    maxJobs?: number;
  },
) {
  let processed = 0;
  let failed = 0;
  const deadline = Date.now() + 4 * 60_000;
  while (processed < (deps.maxJobs ?? 5) && Date.now() < deadline) {
    const run = await claimNextJob(db, { kinds: [RESUME_JOB_KIND], leaseSeconds: 240 });
    if (!run) break;
    processed++;
    const payload = payloadSchema.safeParse(run.payload);
    if (!payload.success || !run.userId) {
      await failJob(db, { ...run, maxAttempts: 1 }, "Invalid résumé extraction job");
      failed++;
      continue;
    }
    const userId = run.userId;
    const resumeFileId = payload.data.resumeFileId;
    try {
      const file = await withUserContext(db, userId, async (tx) => {
        const [resume] = await tx
          .select()
          .from(schema.resumeFiles)
          .where(eq(schema.resumeFiles.id, resumeFileId));
        const [profile] = await tx
          .select()
          .from(schema.candidateProfiles)
          .where(eq(schema.candidateProfiles.sourceResumeFileId, resumeFileId));
        if (!resume || !profile) return null;
        await tx
          .update(schema.resumeFiles)
          .set({ status: "extracting", error: null, updatedAt: new Date() })
          .where(eq(schema.resumeFiles.id, resumeFileId));
        return resume;
      });
      if (!file) {
        await completeJob(db, run.id, { superseded: true });
        continue;
      }
      const bytes = await deps.storage.get(file.storagePath);
      const source = await (deps.parse ?? parseResume)(bytes, file.originalFilename, file.mimeType);
      const redacted = redactResume(source);
      const result = await deps.extractor.extract(userId, redacted.text);
      const verified = verifyExtractedProfile(result.content, source);
      if (!hasEvidence(verified.content)) {
        throw new ResumeInputError(
          "No verified profile entries were found. Try a clearer layout or build your profile manually.",
        );
      }
      verified.content.links = redacted.links;
      await db.transaction(async (tx) => {
        await completeJob(tx, run.id, {
          cached: result.cached,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          quoteValidityRate: result.quoteValidityRate,
        });
        await applyExtractedProfile(tx, userId, resumeFileId, source, verified.content);
      });
      logger.info(
        {
          runId: run.id,
          cached: result.cached,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          quoteValidityRate: result.quoteValidityRate,
        },
        "résumé extraction finished",
      );
    } catch (error) {
      const permanent = error instanceof ResumeInputError;
      const message = permanent
        ? error.message
        : error instanceof RateLimitError
          ? "Extraction quota reached. Your résumé is queued for another attempt."
          : "Résumé extraction is temporarily unavailable. Try again later or build your profile manually.";
      const retry = await failJob(db, permanent ? { ...run, maxAttempts: 1 } : run, message);
      if (error instanceof RateLimitError && retry.retrying) {
        await db
          .update(schema.jobRuns)
          .set({
            scheduledAt: new Date(Date.now() + error.retryAfterSeconds * 1000),
          })
          .where(eq(schema.jobRuns.id, run.id));
      }
      await withUserContext(db, userId, (tx) =>
        tx
          .update(schema.resumeFiles)
          .set({
            status: retry.retrying ? "uploaded" : "failed",
            error: message,
            updatedAt: new Date(),
          })
          .where(eq(schema.resumeFiles.id, resumeFileId)),
      );
      failed++;
      logger.warn({ runId: run.id, retrying: retry.retrying }, "résumé extraction deferred or failed");
    }
  }
  return { processed, failed };
}

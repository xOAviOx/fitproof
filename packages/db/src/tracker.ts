import type { ApplicationUpdate } from "@repo/core";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { withUserContext } from "./rls";
import { applications, jobs, matches, savedJobs } from "./schema";

export class TrackerError extends Error {}

/** Saving snapshots the title, company, and link so the entry survives the job being pruned. */
export async function saveToTracker(db: Database, userId: string, jobId: string) {
  return withUserContext(db, userId, async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job) throw new TrackerError("That job is no longer available.");
    await tx.insert(savedJobs).values({ userId, jobId }).onConflictDoNothing();
    await tx
      .insert(applications)
      .values({
        userId,
        jobId,
        jobTitle: job.title,
        companyName: job.companyName,
        applyUrl: job.applyUrl ?? job.sourceUrl,
        status: "saved",
      })
      .onConflictDoNothing();
    const [application] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)));
    if (!application) throw new Error("Tracker entry was not created");
    return application;
  });
}

export async function listApplications(db: Database, userId: string) {
  return withUserContext(db, userId, (tx) =>
    tx
      .select({
        id: applications.id,
        jobId: applications.jobId,
        jobTitle: applications.jobTitle,
        companyName: applications.companyName,
        applyUrl: applications.applyUrl,
        status: applications.status,
        notes: applications.notes,
        appliedAt: applications.appliedAt,
        nextActionAt: applications.nextActionAt,
        createdAt: applications.createdAt,
        updatedAt: applications.updatedAt,
        jobClosedAt: jobs.closedAt,
        jobAvailable: sql<boolean>`${jobs.id} is not null`,
        band: matches.band,
      })
      .from(applications)
      .leftJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(matches, and(eq(matches.jobId, applications.jobId), eq(matches.userId, userId)))
      .where(eq(applications.userId, userId))
      .orderBy(desc(applications.updatedAt))
      .limit(500),
  );
}
export type TrackerEntry = Awaited<ReturnType<typeof listApplications>>[number];

/** `revision` is the `updatedAt` the editor loaded; a stale edit is rejected. */
export async function updateApplication(
  db: Database,
  userId: string,
  id: string,
  input: ApplicationUpdate & { revision: string },
) {
  return withUserContext(db, userId, async (tx) => {
    const [current] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, userId)))
      .for("update");
    if (!current) throw new TrackerError("That tracker entry no longer exists.");
    if (current.updatedAt.toISOString() !== input.revision) {
      throw new TrackerError("This entry changed in another tab. Reload before saving.");
    }
    const [saved] = await tx
      .update(applications)
      .set({
        status: input.status,
        notes: input.notes,
        nextActionAt: input.nextActionAt ? new Date(`${input.nextActionAt}T00:00:00Z`) : null,
        appliedAt:
          input.status === "saved"
            ? null
            : (current.appliedAt ?? (input.status === "applied" ? new Date() : null)),
        updatedAt: new Date(),
      })
      .where(eq(applications.id, id))
      .returning();
    return saved;
  });
}

export async function removeApplication(db: Database, userId: string, id: string) {
  return withUserContext(db, userId, async (tx) => {
    const [removed] = await tx
      .delete(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, userId)))
      .returning({ jobId: applications.jobId });
    if (removed?.jobId) {
      await tx.delete(savedJobs).where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, removed.jobId)));
    }
    return Boolean(removed);
  });
}

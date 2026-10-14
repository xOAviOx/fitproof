import { createHash } from "node:crypto";
import {
  type ExplanationStatus,
  type GapResponse,
  JOB_ANALYSIS_KIND,
  type MatchBand,
  normalizeTerm,
  parseHardRequirement,
  type StoredRequirement,
  skillKey,
  skillLabel,
  type VerifiedJob,
} from "@repo/core";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database, DbOrTx } from "./client";
import { enqueueJob } from "./queue";
import { withUserContext } from "./rls";
import {
  applications,
  candidateProfiles,
  jobPostings,
  jobRequirements,
  jobRuns,
  jobs,
  matches,
  matchFeedback,
  profileSkills,
} from "./schema";

export type UserJobSource = "user_paste" | "user_url";
export type NewUserJob = {
  source: UserJobSource;
  /** Already cleaned with `cleanJobText` and length-checked. */
  description: string;
  sourceUrl: string | null;
  title: string | null;
  company: string | null;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Shown until analysis reads the real title and company from the posting. */
export const USER_JOB_PLACEHOLDER = { title: "Job you added", company: "Company not stated" } as const;
const normalizedSkillName = (name: string) => name.normalize("NFKC").toLowerCase().trim();

/**
 * Private jobs are written by trusted server code (users have no insert policy on `jobs`).
 * The same text added twice by one user reuses the first job; a failed analysis is requeued.
 */
export async function createUserJob(db: Database, userId: string, input: NewUserJob) {
  const contentHash = sha256(input.description);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: jobs.id, status: jobs.requirementsStatus })
      .from(jobs)
      .where(and(eq(jobs.ownerUserId, userId), eq(jobs.contentHash, contentHash), isNull(jobs.closedAt)))
      .limit(1);
    if (existing) {
      if (existing.status !== "failed") return { jobId: existing.id, runId: null, created: false };
      await tx.update(jobs).set({ requirementsStatus: "pending" }).where(eq(jobs.id, existing.id));
      const run = await enqueueJob(tx, { kind: JOB_ANALYSIS_KIND, userId, payload: { jobId: existing.id } });
      return { jobId: existing.id, runId: run.id, created: false };
    }
    const title = input.title?.trim() || USER_JOB_PLACEHOLDER.title;
    const company = input.company?.trim() || USER_JOB_PLACEHOLDER.company;
    const [job] = await tx
      .insert(jobs)
      .values({
        ownerUserId: userId,
        title,
        companyName: company,
        normalizedTitle: normalizeTerm(title),
        normalizedCompany: normalizeTerm(company),
        source: input.source,
        sourceName: input.sourceUrl
          ? new URL(input.sourceUrl).hostname.replace(/^www\./, "")
          : "Pasted by you",
        sourceUrl: input.sourceUrl,
        applyUrl: input.sourceUrl,
        descriptionText: input.description,
        contentHash,
      })
      .returning({ id: jobs.id });
    if (!job) throw new Error("Job insert returned no row");
    const run = await enqueueJob(tx, { kind: JOB_ANALYSIS_KIND, userId, payload: { jobId: job.id } });
    return { jobId: job.id, runId: run.id, created: true };
  });
}

type RequirementRow = typeof jobRequirements.$inferSelect;
export function toStoredRequirement(row: RequirementRow): StoredRequirement {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    quote: row.quote,
    skill: row.normalizedSkill,
    eligibility: row.type === "hard_eligibility" ? parseHardRequirement(row) : null,
  };
}

/** Trusted-code read for the analysis pipeline. */
export async function loadJobForAnalysis(db: DbOrTx, jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return null;
  const rows = await db
    .select()
    .from(jobRequirements)
    .where(eq(jobRequirements.jobId, jobId))
    .orderBy(asc(jobRequirements.sortOrder));
  return { job, requirements: rows.map(toStoredRequirement) };
}

/** Replaces the job's facts and requirements with a verified extraction. */
export async function saveJobAnalysis(db: Database, jobId: string, verified: VerifiedJob) {
  return db.transaction(async (tx) => {
    await tx
      .update(jobs)
      .set({
        title: verified.title,
        companyName: verified.company,
        normalizedTitle: normalizeTerm(verified.title),
        normalizedCompany: normalizeTerm(verified.company),
        normalizedLocation: normalizeTerm(verified.locations.join(" ")),
        locations: verified.locations,
        remoteType: verified.remoteType,
        employmentType: verified.employmentType,
        seniority: verified.seniority,
        roleFamily: verified.roleFamily,
        salaryMin: verified.salary?.min ?? null,
        salaryMax: verified.salary?.max ?? null,
        salaryCurrency: verified.salary?.currency ?? null,
        salaryPeriod: verified.salary?.period ?? null,
        requirementsStatus: "ready",
        lastVerifiedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    await tx.delete(jobRequirements).where(eq(jobRequirements.jobId, jobId));
    if (!verified.requirements.length) return [];
    const rows = await tx
      .insert(jobRequirements)
      .values(
        verified.requirements.map((requirement, sortOrder) => ({
          jobId,
          type: requirement.type,
          text: requirement.text,
          quote: requirement.quote,
          normalizedSkill: requirement.skill,
          eligibilityKind: requirement.eligibility?.kind ?? null,
          eligibilityValue: (requirement.eligibility?.value ?? null) as Record<string, unknown> | null,
          sortOrder,
        })),
      )
      .returning();
    return rows.sort((a, b) => a.sortOrder - b.sortOrder).map(toStoredRequirement);
  });
}

/**
 * Queues a fresh analysis of one of the user's jobs (a re-check, or a retry after failure). An
 * analysis that is already queued or running is reused instead of queueing a second one.
 */
export async function requestJobAnalysis(db: Database, userId: string, jobId: string) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ id: jobs.id, status: jobs.requirementsStatus })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.ownerUserId, userId)))
      .for("update");
    if (!job) return null;
    const [active] = await tx
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.userId, userId),
          analysisRunFor(jobId),
          inArray(jobRuns.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (active) return { runId: active.id, created: false };
    if (job.status === "failed") {
      await tx.update(jobs).set({ requirementsStatus: "pending" }).where(eq(jobs.id, jobId));
    }
    const run = await enqueueJob(tx, { kind: JOB_ANALYSIS_KIND, userId, payload: { jobId } });
    return { runId: run.id, created: true };
  });
}

export async function markJobAnalysisFailed(db: DbOrTx, jobId: string) {
  await db.update(jobs).set({ requirementsStatus: "failed" }).where(eq(jobs.id, jobId));
}

export type MatchValues = {
  band: MatchBand;
  score: number;
  scoreBreakdown: Record<string, unknown>;
  explanation: Record<string, unknown> | null;
  explanationStatus: ExplanationStatus;
  profileHash: string;
};

export async function saveMatch(db: DbOrTx, userId: string, jobId: string, values: MatchValues) {
  return withUserContext(db, userId, async (tx) => {
    const [row] = await tx
      .insert(matches)
      .values({ userId, jobId, ...values, computedAt: new Date() })
      .onConflictDoUpdate({
        target: [matches.userId, matches.jobId],
        set: { ...values, computedAt: new Date() },
      })
      .returning();
    return row;
  });
}

export async function loadMatch(db: Database, userId: string, jobId: string) {
  return withUserContext(db, userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(matches)
      .where(and(eq(matches.userId, userId), eq(matches.jobId, jobId)));
    return row ?? null;
  });
}

const analysisRunFor = (jobId: string) =>
  and(eq(jobRuns.kind, JOB_ANALYSIS_KIND), sql`${jobRuns.payload}->>'jobId' = ${jobId}`);

/** Everything the job page needs, read under RLS. Returns null for jobs the user can't see. */
export async function loadUserJob(db: Database, userId: string, jobId: string) {
  return withUserContext(db, userId, async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job) return null;
    const requirementRows = await tx
      .select()
      .from(jobRequirements)
      .where(eq(jobRequirements.jobId, jobId))
      .orderBy(asc(jobRequirements.sortOrder));
    const [match] = await tx
      .select()
      .from(matches)
      .where(and(eq(matches.userId, userId), eq(matches.jobId, jobId)));
    const feedback = await tx
      .select({ requirementId: matchFeedback.requirementId, response: matchFeedback.gapResponse })
      .from(matchFeedback)
      .where(
        and(
          eq(matchFeedback.userId, userId),
          eq(matchFeedback.jobId, jobId),
          eq(matchFeedback.kind, "gap_response"),
        ),
      );
    const [application] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)));
    const [run] = await tx
      .select({
        id: jobRuns.id,
        status: jobRuns.status,
        error: jobRuns.error,
        attempts: jobRuns.attempts,
        maxAttempts: jobRuns.maxAttempts,
      })
      .from(jobRuns)
      .where(and(eq(jobRuns.userId, userId), analysisRunFor(jobId)))
      .orderBy(desc(jobRuns.createdAt))
      .limit(1);
    const gapResponses = new Map<string, GapResponse>();
    for (const item of feedback) {
      if (item.requirementId && item.response) gapResponses.set(item.requirementId, item.response);
    }
    return {
      job,
      requirements: requirementRows.map(toStoredRequirement),
      match: match ?? null,
      gapResponses,
      application: application ?? null,
      run: run ?? null,
    };
  });
}
export type UserJob = NonNullable<Awaited<ReturnType<typeof loadUserJob>>>;

/** Light status for polling while analysis runs. */
export async function loadUserJobStatus(db: Database, userId: string, jobId: string) {
  return withUserContext(db, userId, async (tx) => {
    const [job] = await tx.select({ status: jobs.requirementsStatus }).from(jobs).where(eq(jobs.id, jobId));
    if (!job) return null;
    const [match] = await tx
      .select({ explanationStatus: matches.explanationStatus, computedAt: matches.computedAt })
      .from(matches)
      .where(and(eq(matches.userId, userId), eq(matches.jobId, jobId)));
    const [run] = await tx
      .select({ id: jobRuns.id, status: jobRuns.status, error: jobRuns.error })
      .from(jobRuns)
      .where(and(eq(jobRuns.userId, userId), analysisRunFor(jobId)))
      .orderBy(desc(jobRuns.createdAt))
      .limit(1);
    return {
      requirements: job.status,
      explanation: match?.explanationStatus ?? null,
      computedAt: match?.computedAt.toISOString() ?? null,
      runId: run?.id ?? null,
      run: run?.status ?? null,
      error: run?.error ?? null,
    };
  });
}

export async function listUserJobs(db: Database, userId: string) {
  return withUserContext(db, userId, (tx) =>
    tx
      .select({
        id: jobs.id,
        title: jobs.title,
        companyName: jobs.companyName,
        sourceName: jobs.sourceName,
        createdAt: jobs.createdAt,
        requirementsStatus: jobs.requirementsStatus,
        closedAt: jobs.closedAt,
        band: matches.band,
        explanationStatus: matches.explanationStatus,
        saved: sql<boolean>`${applications.id} is not null`,
      })
      .from(jobs)
      .leftJoin(matches, and(eq(matches.jobId, jobs.id), eq(matches.userId, userId)))
      .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
      .where(eq(jobs.ownerUserId, userId))
      .orderBy(desc(jobs.createdAt))
      .limit(100),
  );
}

export class GapResponseError extends Error {}

/**
 * Records a gap answer. "I have this" adds the skill to the profile as confirmed, self-declared
 * evidence (origin `gap_prompt`); switching to "I don't have this" removes only a skill added that way.
 * Returns whether the profile changed, so the caller knows to re-score.
 */
export async function recordGapResponse(
  db: Database,
  userId: string,
  input: { jobId: string; requirementId: string; response: GapResponse },
) {
  return withUserContext(db, userId, async (tx) => {
    const [requirement] = await tx
      .select()
      .from(jobRequirements)
      .where(
        and(
          eq(jobRequirements.id, input.requirementId),
          eq(jobRequirements.jobId, input.jobId),
          inArray(jobRequirements.type, ["core_skill", "nice_to_have"]),
          isNotNull(jobRequirements.normalizedSkill),
        ),
      );
    if (!requirement?.normalizedSkill) throw new GapResponseError("That requirement can't be answered.");
    await tx
      .delete(matchFeedback)
      .where(
        and(
          eq(matchFeedback.userId, userId),
          eq(matchFeedback.jobId, input.jobId),
          eq(matchFeedback.requirementId, input.requirementId),
          eq(matchFeedback.kind, "gap_response"),
        ),
      );
    await tx.insert(matchFeedback).values({
      userId,
      jobId: input.jobId,
      kind: "gap_response",
      gapResponse: input.response,
      requirementId: input.requirementId,
    });

    await tx.insert(candidateProfiles).values({ userId }).onConflictDoNothing();
    const [profile] = await tx.select().from(candidateProfiles).limit(1).for("update");
    if (!profile) throw new Error("Profile was not created");
    const key = requirement.normalizedSkill;
    const skills = await tx.select().from(profileSkills).where(eq(profileSkills.profileId, profile.id));
    const sameSkill = skills.filter((row) => skillKey(row.name) === key);
    let changed = false;
    if (input.response === "has_it") {
      const unconfirmed = sameSkill.filter((row) => !row.userConfirmed);
      if (!sameSkill.some((row) => row.userConfirmed) && unconfirmed.length) {
        await tx
          .update(profileSkills)
          .set({ userConfirmed: true })
          .where(
            inArray(
              profileSkills.id,
              unconfirmed.map((row) => row.id),
            ),
          );
        changed = true;
      } else if (!sameSkill.length) {
        const name = skillLabel(key, requirement.text).slice(0, 120);
        await tx.insert(profileSkills).values({
          userId,
          profileId: profile.id,
          name,
          normalizedName: normalizedSkillName(name),
          tier: "self_declared",
          origin: "gap_prompt",
          userConfirmed: true,
        });
        changed = true;
      }
    } else {
      const added = sameSkill.filter((row) => row.origin === "gap_prompt");
      if (added.length) {
        await tx.delete(profileSkills).where(
          inArray(
            profileSkills.id,
            added.map((row) => row.id),
          ),
        );
        changed = true;
      }
    }
    if (changed) {
      await tx
        .update(candidateProfiles)
        .set({ updatedAt: new Date() })
        .where(eq(candidateProfiles.id, profile.id));
    }
    return { profileChanged: changed };
  });
}

export type CachedJobPage = {
  url: string;
  title: string | null;
  company: string | null;
  text: string;
  method: string;
};

/**
 * Fetched pages are public postings, so one cache serves every user. Rows live in `job_postings`
 * (server-only, no user id) under source `user_url`, keyed by a hash of the requested URL.
 */
export async function loadCachedJobPage(db: DbOrTx, requestedUrl: string, maxAgeHours = 24) {
  const [row] = await db
    .select()
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.source, "user_url"),
        eq(jobPostings.sourceJobId, sha256(requestedUrl)),
        gt(jobPostings.lastSeenAt, new Date(Date.now() - maxAgeHours * 3600_000)),
      ),
    );
  if (!row) return null;
  return {
    url: row.sourceUrl ?? requestedUrl,
    title: row.title || null,
    company: row.companyName || null,
    text: row.descriptionText,
    method: String(row.raw.method ?? "unknown"),
  } satisfies CachedJobPage;
}

export async function cacheJobPage(db: DbOrTx, requestedUrl: string, page: CachedJobPage) {
  const values = {
    sourceUrl: page.url,
    applyUrl: page.url,
    title: page.title ?? "",
    companyName: page.company ?? "",
    descriptionText: page.text,
    raw: { method: page.method, requestedUrl },
    contentHash: sha256(page.text),
    lastSeenAt: new Date(),
  };
  await db
    .insert(jobPostings)
    .values({ source: "user_url", sourceJobId: sha256(requestedUrl), ...values })
    .onConflictDoUpdate({ target: [jobPostings.source, jobPostings.sourceJobId], set: values });
}

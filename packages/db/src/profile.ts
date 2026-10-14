import {
  allEvidenceConfirmed,
  EVIDENCE_SECTIONS,
  emptyProfile,
  hasEvidence,
  type ProfileContent,
  profileContentSchema,
  RESUME_JOB_KIND,
} from "@repo/core";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database, Transaction } from "./client";
import { enqueueJob } from "./queue";
import { withUserContext } from "./rls";
import {
  candidateProfiles,
  profileCertifications,
  profileEducation,
  profileExperiences,
  profileProjects,
  profileSkills,
  resumeFiles,
} from "./schema";

export class ProfileConflictError extends Error {
  constructor() {
    super("Your profile changed in another tab or a new résumé finished processing. Reload before saving.");
  }
}

async function readContent(tx: Transaction, profileId: string): Promise<ProfileContent> {
  const skills = await tx
    .select()
    .from(profileSkills)
    .where(eq(profileSkills.profileId, profileId))
    .orderBy(asc(profileSkills.createdAt));
  const experiences = await tx
    .select()
    .from(profileExperiences)
    .where(eq(profileExperiences.profileId, profileId))
    .orderBy(asc(profileExperiences.sortOrder));
  const projects = await tx
    .select()
    .from(profileProjects)
    .where(eq(profileProjects.profileId, profileId))
    .orderBy(asc(profileProjects.sortOrder));
  const education = await tx
    .select()
    .from(profileEducation)
    .where(eq(profileEducation.profileId, profileId))
    .orderBy(asc(profileEducation.sortOrder));
  const certifications = await tx
    .select()
    .from(profileCertifications)
    .where(eq(profileCertifications.profileId, profileId))
    .orderBy(asc(profileCertifications.sortOrder));
  const evidence = <T extends { sourceText: string }>(rows: T[]) =>
    rows.map((row) => ({ ...row, sourceText: row.sourceText || null }));
  return profileContentSchema.parse({
    ...emptyProfile(),
    skills: evidence(skills),
    experiences: evidence(experiences),
    projects: evidence(projects),
    education: evidence(education).map((row) => ({
      ...row,
      score: row.score === null ? null : Number(row.score),
      scoreScale: row.scoreScale === null ? null : Number(row.scoreScale),
    })),
    certifications: evidence(certifications),
  });
}

export async function loadProfile(db: Database, userId: string) {
  return withUserContext(db, userId, async (tx) => {
    const [profile] = await tx.select().from(candidateProfiles).limit(1);
    const [resume] = await tx
      .select()
      .from(resumeFiles)
      .where(profile?.sourceResumeFileId ? eq(resumeFiles.id, profile.sourceResumeFileId) : undefined)
      .orderBy(desc(resumeFiles.createdAt))
      .limit(1);
    if (!profile) return { profile: null, content: emptyProfile(), resume: resume ?? null };
    const content = await readContent(tx, profile.id);
    content.summary = profile.summary;
    content.links = profile.links;
    return { profile, content, resume: resume ?? null };
  });
}

export async function loadResumeStatus(db: Database, userId: string) {
  return withUserContext(db, userId, async (tx) => {
    const [resume] = await tx
      .select({ status: resumeFiles.status, error: resumeFiles.error })
      .from(candidateProfiles)
      .innerJoin(resumeFiles, eq(candidateProfiles.sourceResumeFileId, resumeFiles.id))
      .limit(1);
    return resume ?? { status: null, error: null };
  });
}

async function replaceContent(tx: Transaction, userId: string, profileId: string, content: ProfileContent) {
  // Origin isn't part of the editable content, so keep it for skills that survive the save.
  const origins = new Map(
    (
      await tx
        .select({ id: profileSkills.id, origin: profileSkills.origin })
        .from(profileSkills)
        .where(eq(profileSkills.profileId, profileId))
    ).map((row) => [row.id, row.origin]),
  );
  for (const table of [
    profileSkills,
    profileExperiences,
    profileProjects,
    profileEducation,
    profileCertifications,
  ]) {
    await tx.delete(table).where(eq(table.profileId, profileId));
  }
  const base = { userId, profileId };
  if (content.skills.length) {
    await tx.insert(profileSkills).values(
      content.skills.map((row) => ({
        ...row,
        ...base,
        sourceText: row.sourceText ?? "",
        normalizedName: row.name.normalize("NFKC").toLowerCase().trim(),
        origin:
          (row.id ? origins.get(row.id) : undefined) ??
          (row.sourceText ? ("resume" as const) : ("manual" as const)),
      })),
    );
  }
  if (content.experiences.length) {
    await tx.insert(profileExperiences).values(
      content.experiences.map((row, sortOrder) => ({
        ...row,
        ...base,
        sourceText: row.sourceText ?? "",
        sortOrder,
      })),
    );
  }
  if (content.projects.length) {
    await tx.insert(profileProjects).values(
      content.projects.map((row, sortOrder) => ({
        ...row,
        ...base,
        sourceText: row.sourceText ?? "",
        sortOrder,
      })),
    );
  }
  if (content.education.length) {
    await tx.insert(profileEducation).values(
      content.education.map((row, sortOrder) => ({
        ...row,
        ...base,
        sourceText: row.sourceText ?? "",
        sortOrder,
        score: row.score?.toString() ?? null,
        scoreScale: row.scoreScale?.toString() ?? null,
      })),
    );
  }
  if (content.certifications.length) {
    await tx.insert(profileCertifications).values(
      content.certifications.map((row, sortOrder) => ({
        ...row,
        ...base,
        sourceText: row.sourceText ?? "",
        sortOrder,
      })),
    );
  }
}

/** Queue insertion happens before the RLS scope, but both are committed in the same owner transaction. */
export async function registerResumeUpload(
  db: Database,
  userId: string,
  file: typeof resumeFiles.$inferInsert & { id: string },
) {
  return db.transaction(async (tx) => {
    const run = await enqueueJob(tx, {
      kind: RESUME_JOB_KIND,
      userId,
      payload: { resumeFileId: file.id },
    });
    await withUserContext(tx, userId, async (scoped) => {
      await scoped.insert(resumeFiles).values({ ...file, userId });
      await scoped
        .insert(candidateProfiles)
        .values({ userId, sourceResumeFileId: file.id })
        .onConflictDoUpdate({
          target: candidateProfiles.userId,
          set: { sourceResumeFileId: file.id, status: "draft", confirmedAt: null, updatedAt: new Date() },
        });
    });
    return run;
  });
}

export async function saveProfile(
  db: Database,
  userId: string,
  input: { content: ProfileContent; revision: string | null; confirm: boolean },
) {
  const content = profileContentSchema.parse(input.content);
  if (input.confirm && (!hasEvidence(content) || !allEvidenceConfirmed(content))) {
    throw new Error("Review and confirm every evidence entry before confirming your profile.");
  }
  return withUserContext(db, userId, async (tx) => {
    await tx.insert(candidateProfiles).values({ userId }).onConflictDoNothing();
    const [profile] = await tx.select().from(candidateProfiles).limit(1).for("update");
    if (!profile) throw new Error("Profile was not created");
    if (input.revision !== null && profile.updatedAt.toISOString() !== input.revision) {
      throw new ProfileConflictError();
    }
    if (input.revision === null && hasEvidence(await readContent(tx, profile.id)))
      throw new ProfileConflictError();
    if (profile.sourceResumeFileId) {
      const [resume] = await tx
        .select()
        .from(resumeFiles)
        .where(eq(resumeFiles.id, profile.sourceResumeFileId));
      if (resume && ["uploaded", "extracting"].includes(resume.status)) {
        throw new Error("Wait for your résumé to finish processing before saving edits.");
      }
    }
    const previous = await readContent(tx, profile.id);
    for (const section of EVIDENCE_SECTIONS) {
      const known = new Map(previous[section].map((row) => [row.id, row]));
      for (const row of content[section]) {
        const old = row.id ? known.get(row.id) : undefined;
        if (row.id && !old) throw new ProfileConflictError();
        const facts = (value: object) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => !["id", "sourceText", "userConfirmed"].includes(key))
                .sort(),
            ),
          );
        row.sourceText = old && facts(old) === facts(row) ? old.sourceText : null;
        if (section === "skills" && row.sourceText === null && "tier" in row) row.tier = "self_declared";
      }
    }
    await replaceContent(tx, userId, profile.id, content);
    const [saved] = await tx
      .update(candidateProfiles)
      .set({
        summary: content.summary,
        links: content.links,
        status: input.confirm ? "confirmed" : "draft",
        confirmedAt: input.confirm ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(candidateProfiles.id, profile.id))
      .returning();
    return saved;
  });
}

/** Called by the worker inside a transaction. A late result can never overwrite a newer upload. */
export async function applyExtractedProfile(
  db: Database | Transaction,
  userId: string,
  resumeFileId: string,
  extractedText: string,
  content: ProfileContent,
) {
  return withUserContext(db, userId, async (tx) => {
    const [profile] = await tx
      .select()
      .from(candidateProfiles)
      .where(eq(candidateProfiles.sourceResumeFileId, resumeFileId))
      .limit(1)
      .for("update");
    await tx
      .update(resumeFiles)
      .set({
        status: "extracted",
        extractedText,
        error: null,
        updatedAt: new Date(),
      })
      .where(and(eq(resumeFiles.id, resumeFileId), eq(resumeFiles.userId, userId)));
    if (!profile) return { superseded: true };
    await replaceContent(tx, userId, profile.id, content);
    await tx
      .update(candidateProfiles)
      .set({
        summary: content.summary,
        links: content.links,
        status: "draft",
        confirmedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(candidateProfiles.id, profile.id));
    return { superseded: false };
  });
}

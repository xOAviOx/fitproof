import { index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ownRowsPolicy, timestamptz, updatedAt } from "./columns";
import { applicationStatusEnum, suggestionStatusEnum, tailoringTypeEnum } from "./enums";
import { jobs } from "./jobs";
import { resumeVersions } from "./resumes";
import { userId } from "./users";

export const savedJobs = pgTable(
  "saved_jobs",
  {
    id: id(),
    userId: userId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("saved_jobs_user_job_key").on(t.userId, t.jobId),
    index("saved_jobs_job_id_idx").on(t.jobId),
    ownRowsPolicy(),
  ],
).enableRLS();

/** Job title, company, and apply URL are snapshotted so the tracker survives job pruning. */
export const applications = pgTable(
  "applications",
  {
    id: id(),
    userId: userId(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    jobTitle: text("job_title").notNull(),
    companyName: text("company_name").notNull(),
    applyUrl: text("apply_url"),
    status: applicationStatusEnum("status").notNull().default("saved"),
    resumeVersionId: uuid("resume_version_id").references(() => resumeVersions.id, {
      onDelete: "set null",
    }),
    appliedAt: timestamptz("applied_at"),
    notes: text("notes"),
    nextActionAt: timestamptz("next_action_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("applications_user_job_key").on(t.userId, t.jobId),
    index("applications_job_id_idx").on(t.jobId),
    ownRowsPolicy(),
  ],
).enableRLS();

export type EvidenceRef = { table: string; id: string; quote: string };

export const tailoringSuggestions = pgTable(
  "tailoring_suggestions",
  {
    id: id(),
    userId: userId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
    resultVersionId: uuid("result_version_id").references(() => resumeVersions.id, {
      onDelete: "set null",
    }),
    type: tailoringTypeEnum("type").notNull(),
    targetRef: text("target_ref").notNull(),
    before: text("before").notNull(),
    after: text("after").notNull(),
    rationale: text("rationale").notNull(),
    evidenceRefs: jsonb("evidence_refs").$type<EvidenceRef[]>().notNull().default([]),
    status: suggestionStatusEnum("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tailoring_suggestions_user_id_idx").on(t.userId),
    index("tailoring_suggestions_job_id_idx").on(t.jobId),
    ownRowsPolicy(),
  ],
).enableRLS();

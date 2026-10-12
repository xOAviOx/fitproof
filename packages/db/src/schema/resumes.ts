import { type AnyPgColumn, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ownRowsPolicy, updatedAt } from "./columns";
import { resumeFileStatusEnum } from "./enums";
import { jobs } from "./jobs";
import { candidateProfiles } from "./profile";
import { userId } from "./users";

/** `extracted_text` contains PII; it is used for quote verification only and is purged on account deletion. */
export const resumeFiles = pgTable(
  "resume_files",
  {
    id: id(),
    userId: userId(),
    storagePath: text("storage_path").notNull().unique(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    status: resumeFileStatusEnum("status").notNull().default("uploaded"),
    extractedText: text("extracted_text"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("resume_files_user_id_idx").on(t.userId), ownRowsPolicy()],
).enableRLS();

/** Immutable snapshots: a new row per accepted tailoring, so applications keep the exact résumé they used. */
export const resumeVersions = pgTable(
  "resume_versions",
  {
    id: id(),
    userId: userId(),
    profileId: uuid("profile_id").references(() => candidateProfiles.id, { onDelete: "set null" }),
    baseVersionId: uuid("base_version_id").references((): AnyPgColumn => resumeVersions.id, {
      onDelete: "set null",
    }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    renderedText: text("rendered_text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("resume_versions_user_id_idx").on(t.userId), ownRowsPolicy()],
).enableRLS();

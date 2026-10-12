import { EMBEDDING_DIMENSIONS } from "@repo/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  real,
  text,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";
import { createdAt, id, timestamptz, updatedAt } from "./columns";
import {
  atsTypeEnum,
  eligibilityKindEnum,
  employmentTypeEnum,
  jobSourceEnum,
  processingStatusEnum,
  remoteTypeEnum,
  requirementTypeEnum,
  roleFamilyEnum,
  seniorityEnum,
} from "./enums";
import { users } from "./users";

const readableByAuthenticated = (using: ReturnType<typeof sql>) =>
  pgPolicy("authenticated_read", { for: "select", to: authenticatedRole, using });

/** Inherits job visibility: the RLS policy on `jobs` also applies inside this subquery. */
const visibleJobSql = (jobIdColumn: string) =>
  sql`exists (select 1 from public.jobs j where j.id = ${sql.raw(jobIdColumn)})`;

export const companies = pgTable(
  "companies",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    atsType: atsTypeEnum("ats_type"),
    boardToken: text("board_token"),
    careersUrl: text("careers_url"),
    hq: text("hq"),
    locations: jsonb("locations").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    lastCrawledAt: timestamptz("last_crawled_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("companies_ats_board_key").on(t.atsType, t.boardToken), readableByAuthenticated(sql`true`)],
).enableRLS();

/** Canonical, deduplicated jobs. `owner_user_id` is set only for private bring-your-own-job entries. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    companyName: text("company_name").notNull(),
    title: text("title").notNull(),
    normalizedCompany: text("normalized_company").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    normalizedLocation: text("normalized_location").notNull().default(""),
    locations: jsonb("locations").$type<string[]>().notNull().default([]),
    remoteType: remoteTypeEnum("remote_type").notNull().default("unknown"),
    employmentType: employmentTypeEnum("employment_type").notNull().default("unknown"),
    seniority: seniorityEnum("seniority").notNull().default("unknown"),
    roleFamily: roleFamilyEnum("role_family"),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period"),
    applyUrl: text("apply_url"),
    canonicalApplyUrl: text("canonical_apply_url"),
    source: jobSourceEnum("source").notNull(),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url"),
    descriptionText: text("description_text").notNull(),
    contentHash: text("content_hash").notNull(),
    simhash: text("simhash"),
    requirementsStatus: processingStatusEnum("requirements_status").notNull().default("pending"),
    firstSeenAt: timestamptz("first_seen_at").notNull().defaultNow(),
    lastVerifiedAt: timestamptz("last_verified_at").notNull().defaultNow(),
    closedAt: timestamptz("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_owner_user_id_idx").on(t.ownerUserId),
    index("jobs_company_id_idx").on(t.companyId),
    index("jobs_content_hash_idx").on(t.contentHash),
    index("jobs_dedupe_idx").on(t.normalizedCompany, t.normalizedTitle),
    readableByAuthenticated(sql`owner_user_id is null or owner_user_id = ${authUid}`),
  ],
).enableRLS();

/** Raw postings exactly as each source returned them. Server-only; pruned after 60 days. */
export const jobPostings = pgTable(
  "job_postings",
  {
    id: id(),
    source: jobSourceEnum("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    sourceUrl: text("source_url"),
    applyUrl: text("apply_url"),
    title: text("title").notNull(),
    companyName: text("company_name").notNull(),
    locationText: text("location_text"),
    descriptionText: text("description_text").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamptz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    closedAt: timestamptz("closed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("job_postings_source_key").on(t.source, t.sourceJobId),
    index("job_postings_job_id_idx").on(t.jobId),
  ],
).enableRLS();

/** Audit log of dedupe decisions: which posting was grouped under which canonical job, and why. */
export const jobDuplicates = pgTable(
  "job_duplicates",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    postingId: uuid("posting_id")
      .notNull()
      .references(() => jobPostings.id, { onDelete: "cascade" }),
    similarity: real("similarity").notNull(),
    method: text("method").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("job_duplicates_posting_key").on(t.postingId),
    index("job_duplicates_job_id_idx").on(t.jobId),
    readableByAuthenticated(visibleJobSql("job_duplicates.job_id")),
  ],
).enableRLS();

export const jobRequirements = pgTable(
  "job_requirements",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: requirementTypeEnum("type").notNull(),
    text: text("text").notNull(),
    quote: text("quote").notNull(),
    normalizedSkill: text("normalized_skill"),
    eligibilityKind: eligibilityKindEnum("eligibility_kind"),
    eligibilityValue: jsonb("eligibility_value").$type<Record<string, unknown>>(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("job_requirements_job_id_idx").on(t.jobId),
    readableByAuthenticated(visibleJobSql("job_requirements.job_id")),
  ],
).enableRLS();

/** Server-only: retrieval runs in trusted code, so no client policy. */
export const jobEmbeddings = pgTable(
  "job_embeddings",
  {
    jobId: uuid("job_id")
      .primaryKey()
      .references(() => jobs.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("job_embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
).enableRLS();

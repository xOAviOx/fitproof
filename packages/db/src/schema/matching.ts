import { EMBEDDING_DIMENSIONS } from "@repo/core";
import { index, jsonb, pgTable, real, text, unique, uuid, vector } from "drizzle-orm/pg-core";
import { createdAt, id, ownRowsPolicy, timestamptz } from "./columns";
import {
  dismissReasonEnum,
  explanationStatusEnum,
  feedbackKindEnum,
  gapResponseEnum,
  matchBandEnum,
} from "./enums";
import { jobRequirements, jobs } from "./jobs";
import { candidateProfiles } from "./profile";
import { userId } from "./users";

export const profileEmbeddings = pgTable(
  "profile_embeddings",
  {
    id: id(),
    userId: userId(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => candidateProfiles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("profile_embeddings_profile_kind_key").on(t.profileId, t.kind),
    index("profile_embeddings_user_id_idx").on(t.userId),
    ownRowsPolicy(),
  ],
).enableRLS();

/** `score` is for ordering only and is never shown to users; the UI shows `band`. */
export const matches = pgTable(
  "matches",
  {
    id: id(),
    userId: userId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    band: matchBandEnum("band").notNull(),
    score: real("score").notNull(),
    scoreBreakdown: jsonb("score_breakdown").$type<Record<string, unknown>>().notNull(),
    explanation: jsonb("explanation").$type<Record<string, unknown>>(),
    explanationStatus: explanationStatusEnum("explanation_status").notNull().default("none"),
    profileHash: text("profile_hash").notNull(),
    computedAt: timestamptz("computed_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("matches_user_job_key").on(t.userId, t.jobId),
    index("matches_job_id_idx").on(t.jobId),
    ownRowsPolicy(),
  ],
).enableRLS();

export const matchFeedback = pgTable(
  "match_feedback",
  {
    id: id(),
    userId: userId(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    kind: feedbackKindEnum("kind").notNull(),
    dismissReason: dismissReasonEnum("dismiss_reason"),
    gapResponse: gapResponseEnum("gap_response"),
    requirementId: uuid("requirement_id").references(() => jobRequirements.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("match_feedback_user_id_idx").on(t.userId),
    index("match_feedback_job_id_idx").on(t.jobId),
    ownRowsPolicy(),
  ],
).enableRLS();

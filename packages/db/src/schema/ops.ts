import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";
import { createdAt, id, timestamptz, updatedAt } from "./columns";
import { jobRunStatusEnum } from "./enums";
import { users } from "./users";

/**
 * The work queue. Background tasks are rows here; a worker claims them by
 * lease (`locked_until`). Users may read their own rows to poll status.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: id(),
    kind: text("kind").notNull(),
    status: jobRunStatusEnum("status").notNull().default("queued"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    error: text("error"),
    scheduledAt: timestamptz("scheduled_at").notNull().defaultNow(),
    lockedUntil: timestamptz("locked_until"),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("job_runs_status_scheduled_idx").on(t.status, t.scheduledAt),
    index("job_runs_kind_created_idx").on(t.kind, t.createdAt),
    index("job_runs_user_id_idx").on(t.userId),
    pgPolicy("select_own", { for: "select", to: authenticatedRole, using: sql`user_id = ${authUid}` }),
  ],
).enableRLS();

export const connectorCursors = pgTable(
  "connector_cursors",
  {
    id: id(),
    connector: text("connector").notNull(),
    scope: text("scope").notNull(),
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("connector_cursors_key").on(t.connector, t.scope)],
).enableRLS();

/** Keyed by a hash of model + prompt version + input. `user_id` lets account deletion purge cached outputs. */
export const llmCache = pgTable(
  "llm_cache",
  {
    key: text("key").primaryKey(),
    model: text("model").notNull(),
    purpose: text("purpose").notNull(),
    response: jsonb("response").$type<unknown>().notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at"),
  },
  (t) => [index("llm_cache_user_id_idx").on(t.userId)],
).enableRLS();

/** Fixed-window counters for Postgres-based rate limiting. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamptz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ name: "rate_limits_pkey", columns: [t.key, t.windowStart] })],
).enableRLS();

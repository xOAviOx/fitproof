import { sql } from "drizzle-orm";
import { boolean, pgPolicy, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const createdAt = () => timestamptz("created_at").notNull().defaultNow();

export const updatedAt = () =>
  timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const sourceText = () => text("source_text").notNull().default("");

export const userConfirmed = () => boolean("user_confirmed").notNull().default(false);

/** Full read/write access to rows the signed-in user owns, nothing else. */
export const ownRowsPolicy = () =>
  pgPolicy("own_rows", {
    for: "all",
    to: authenticatedRole,
    using: sql`user_id = ${authUid}`,
    withCheck: sql`user_id = ${authUid}`,
  });

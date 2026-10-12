import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";
import { createdAt } from "./columns";

/** Mirrors auth.users (kept in sync by a trigger) so app tables never reference the auth schema directly. */
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    email: text("email"),
    createdAt: createdAt(),
  },
  () => [pgPolicy("select_own", { for: "select", to: authenticatedRole, using: sql`id = ${authUid}` })],
).enableRLS();

export const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

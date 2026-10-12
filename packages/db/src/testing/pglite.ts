import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "../client";
import { MIGRATIONS_FOLDER } from "../migrations-path";
import * as schema from "../schema";
import { SUPABASE_STUB_SQL } from "./supabase-stub";

export type TestDb = { db: Database; client: PGlite; close: () => Promise<void> };

/** A fresh in-memory Postgres with the Supabase stub and all migrations applied. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite({ extensions: { vector } });
  await client.exec(SUPABASE_STUB_SQL);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, close: () => client.close() };
}

/** Simulates a Supabase sign-up; the auth trigger creates the matching public.users row. */
export async function createAuthUser(db: Database, email = `${randomUUID()}@example.test`): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`insert into auth.users (id, email) values (${id}, ${email})`);
  return id;
}

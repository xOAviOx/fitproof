import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
type Relations = ExtractTablesWithRelations<Schema>;

/** Driver-agnostic so the same queries run on postgres-js in production and PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, Schema, Relations>;
export type Transaction = PgTransaction<PgQueryResultHKT, Schema, Relations>;
export type DbOrTx = Database | Transaction;

export type DbHandle = { db: Database; close: () => Promise<void> };

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  // Supabase's transaction pooler (port 6543) does not support prepared statements.
  const client = postgres(url, {
    prepare: false,
    max: options.max ?? 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}

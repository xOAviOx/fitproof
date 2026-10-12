import "server-only";
import { createDb, type Database, type DbHandle } from "@repo/db";
import { serverEnv } from "@/env";

// Reuse one pool per server instance; dev hot reload would otherwise leak connections.
const globalForDb = globalThis as typeof globalThis & { __fitwiseDb?: DbHandle };

export function getDb(): Database {
  if (!globalForDb.__fitwiseDb) {
    const env = serverEnv();
    globalForDb.__fitwiseDb = createDb(env.DATABASE_URL, { max: env.DATABASE_POOL_MAX });
  }
  return globalForDb.__fitwiseDb.db;
}

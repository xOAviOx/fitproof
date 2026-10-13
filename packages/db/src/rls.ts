import { sql } from "drizzle-orm";
import type { DbOrTx, Transaction } from "./client";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction as Supabase's `authenticated` role with the given
 * user's JWT claims, so Row Level Security applies to app queries exactly as it
 * does to the Supabase Data API. `userId` must come from a verified session.
 */
export async function withUserContext<T>(
  db: DbOrTx,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error("withUserContext requires a UUID user id");
  }
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

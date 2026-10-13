import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "./client";
import { rateLimits } from "./schema";

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many requests. Please wait and try again.");
  }
}

/** Owner-only operational query. The returned counter is atomic across web and worker instances. */
export async function consumeRateLimit(
  db: DbOrTx,
  key: string,
  limit: number,
  windowSeconds: number,
  now = new Date(),
) {
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
      setWhere: and(eq(rateLimits.key, key), sql`${rateLimits.count} < ${limit}`),
    })
    .returning({ count: rateLimits.count });
  if (!row) {
    throw new RateLimitError(
      Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000),
    );
  }
}

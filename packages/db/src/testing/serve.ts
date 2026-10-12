import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { SUPABASE_STUB_SQL } from "./supabase-stub";

/**
 * In-memory Postgres speaking the wire protocol, for smoke tests on machines
 * without Docker. It has no Supabase Auth, so sign-in flows cannot run against it.
 * Usage: pnpm --filter @repo/db pglite:serve  (then pnpm db:migrate)
 */
const port = Number(process.env.PGLITE_PORT ?? 54329);
const db = await PGlite.create({ extensions: { vector } });
await db.exec(SUPABASE_STUB_SQL);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
await server.start();
console.log(`PGlite listening on postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { MIGRATIONS_FOLDER } from "./migrations-path";

/**
 * Applies committed migrations. Use the direct (session, port 5432)
 * connection string here, not the transaction pooler.
 */
async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_MIGRATION_URL (preferred) or DATABASE_URL to run migrations.");
    process.exit(1);
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("Migrations applied.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

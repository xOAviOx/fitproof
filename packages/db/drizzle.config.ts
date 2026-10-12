import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
  strict: true,
  verbose: true,
});

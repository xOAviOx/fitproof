import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54329/postgres";

/**
 * Smoke e2e against a production build. Without E2E_BASE_URL it starts an
 * in-memory PGlite database, applies migrations, and runs `next start`
 * (run `pnpm build` first). Set PW_CHANNEL=chrome to use a locally installed Chrome.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  // PGlite socket sessions share unnamed prepared statements. Local browser flows must not overlap.
  workers: process.env.E2E_BASE_URL ? undefined : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "pnpm --filter @repo/db pglite:serve",
          port: 54329,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: "pnpm exec tsx e2e/services.ts",
          url: "http://127.0.0.1:54321/health",
          reuseExistingServer: false,
          env: { DATABASE_URL, DATABASE_MIGRATION_URL: DATABASE_URL },
        },
        {
          command: `pnpm exec next start --hostname 127.0.0.1 -p ${PORT}`,
          url: `${baseURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          env: {
            DATABASE_URL,
            // Set explicitly so a DATABASE_MIGRATION_URL in the root .env can't point migrations elsewhere.
            DATABASE_MIGRATION_URL: DATABASE_URL,
            DATABASE_POOL_MAX: "1",
            NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder_for_ci_builds",
            NEXT_PUBLIC_SITE_URL: baseURL,
            RESUME_UPLOADS_ENABLED: "true",
            ADMIN_EMAILS: "owner@example.test",
            SUPABASE_SECRET_KEY: "e2e-storage-secret-never-use-in-production",
            // Empty keys win over the root .env, so jobs are always read by keyword, never by a live model.
            GEMINI_API_KEY: "",
            OPENAI_API_KEY: "",
          },
        },
      ],
});

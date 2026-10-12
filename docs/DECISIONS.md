# Architecture decisions

Short ADRs. Newest last. Status is one of: Accepted, Superseded, Proposed.

---

## ADR-001: Working product name and package scope

- **Status:** Accepted (M0)
- **Context:** The product name was left as a placeholder.
- **Decision:** Use "Fitwise" as the working name, defined once in `packages/core/src/product.ts`. Internal packages use the neutral `@repo/*` scope, so a rename touches one constant and the root `package.json` name.

## ADR-002: Stack as specified

- **Status:** Accepted (M0)
- **Decision:** TypeScript everywhere, using a pnpm workspace plus Turborepo, Next.js 16 (App Router) on Vercel, Supabase (Postgres + pgvector, Auth, Storage), Drizzle ORM with committed migrations, Zod at boundaries, Vitest and Playwright for tests, and GitHub Actions for CI and schedules.
- **Rejected:** a Python backend split, Elasticsearch/Typesense, BullMQ/Redis, and microservices. The reasons are in the master prompt.

## ADR-003: Pin TypeScript 6.0, not 7.0

- **Status:** Accepted (M0)
- **Context:** TypeScript 7.0 (the native Go compiler) became `latest` in 2026. Next.js, drizzle-kit, and editor tooling load TypeScript's JavaScript API, and compatibility with 7.0 is not guaranteed.
- **Decision:** Pin `typescript@~6.0.3`, the last JavaScript-based release.
- **Revisit:** when Next.js documents 7.0 support.

## ADR-004: Biome instead of ESLint + Prettier

- **Status:** Accepted (M0)
- **Decision:** One tool, one config (`biome.json`), fast enough to run on every save. `noExplicitAny` and `noNonNullAssertion` are errors. Next.js 16 no longer bundles `next lint`, so ESLint would have meant extra configuration.
- **Trade-off:** we lose the Next.js-specific ESLint rules (for example `no-img-element`). Code review covers these.

## ADR-005: RLS on every table, and app queries run under RLS too

- **Status:** Accepted (M0)
- **Context:** Supabase exposes `public` tables through its Data API using the publishable key, and grants table privileges to API roles by default. Drizzle connects as `postgres`, which bypasses RLS.
- **Decision:**
  1. Enable RLS on **every** table. User-owned tables get an `own_rows` policy (`user_id = auth.uid()`). Shared job tables get read-only policies, and pasted (bring-your-own) jobs are visible only to their owner. Server-only tables (`job_postings`, `job_embeddings`, `llm_cache`, `connector_cursors`, `rate_limits`) have RLS enabled with **no** policies, which denies all API access.
  2. User-facing server code runs queries through `withUserContext(db, userId, fn)`. It opens a transaction, sets `request.jwt.claims`, and runs `SET LOCAL ROLE authenticated`, so a bug in a query's `WHERE` clause cannot leak another user's rows. Pipelines (worker) use the owner connection deliberately.
  3. Policies are declared next to their tables in the Drizzle schema, so drizzle-kit emits them into migrations.
- **Evidence:** `packages/db/src/rls.test.ts` (71 tests) checks that every table has RLS, every policy on a table with `user_id` is scoped to `auth.uid()`, and user A cannot read, update, delete, insert, or reassign user B's rows in each of the 15 user-owned tables. It also checks that anonymous users see nothing. A mutation check (removing the role switch) makes the suite fail.

## ADR-006: Denormalize `user_id` onto every user-owned row

- **Status:** Accepted (M0)
- **Decision:** Child tables (for example `profile_skills`) carry `user_id` even though they could inherit it through `profile_id`.
- **Why:** RLS policies stay a simple, indexable equality check with no subqueries, isolation tests are uniform, and account deletion cascades from one place.

## ADR-007: Domain vocabulary lives in `@repo/core`; Postgres enums derive from it

- **Status:** Accepted (M0)
- **Decision:** Arrays such as `EVIDENCE_TIERS` and `REQUIREMENT_TYPES` in `packages/core/src/vocab.ts` are the single source for Postgres enums, Zod schemas, and the UI.
- **Trade-off:** removing an enum value requires a data migration. Adding one requires a generated migration (`ALTER TYPE ... ADD VALUE`).

## ADR-008: `jsonb` for list columns

- **Status:** Accepted (M0)
- **Decision:** Lists such as skills, bullets, locations, and desired roles are stored as `jsonb` arrays rather than Postgres arrays.
- **Why:** Drizzle typing is simpler, JSON round-trips identically through every driver, and GIN indexes with `jsonb_path_ops` support containment filters when discovery needs them (M5).

## ADR-009: PGlite instead of Docker for database tests

- **Status:** Accepted (M0)
- **Context:** The development machine has no Docker, and the Supabase CLI's local stack requires it.
- **Decision:** DB tests run against PGlite (real Postgres compiled to WASM, with pgvector) plus a stub of the Supabase pieces we depend on: the `anon`, `authenticated`, and `service_role` roles, `auth.users`, `auth.uid()`, and the default grants (`packages/db/src/testing/supabase-stub.ts`). `pglite:serve` exposes the same database over the Postgres wire protocol for smoke tests and e2e.
- **Limits:** the stub is not Supabase. Auth flows (magic link, OAuth) cannot be exercised locally. Live verification happens on a real Supabase project. A CI job using `supabase start` can be added later if the stub ever drifts.
- **Pins:** `@electric-sql/pglite@0.5.8`, `pglite-pgvector@0.0.9`, and `pglite-socket@0.2.11` are pinned exactly, because WASM extensions must match the PGlite build.

## ADR-010: Embedding width 768

- **Status:** Accepted (M0)
- **Decision:** `vector(768)` columns with HNSW cosine indexes. Gemini's embedding model supports reduced output sizes, and 768 keeps indexes small on the free database tier.
- **Trade-off:** changing it requires a migration and a full re-embed (`worker backfill`, M4/M5).

## ADR-011: The job queue is a Postgres table behind one module

- **Status:** Accepted (M0)
- **Decision:** `job_runs` holds queued and scheduled work. `claimNextJob` leases one due job atomically (`FOR UPDATE SKIP LOCKED`) with a `locked_until` lease. Expired leases are reclaimable until attempts run out, and failures retry with exponential backoff (30 s, 60 s, ...). Users can read their own rows to poll status.
- **Why:** no Redis host is needed on the free tier. All queue semantics sit in `packages/db/src/queue.ts`, so a managed queue can replace it without touching callers.

## ADR-012: Auth flows

- **Status:** Accepted (M0)
- **Decision:**
  - Magic link and Google OAuth complete at `/auth/callback` (PKCE code exchange). Token-hash magic links complete at `/auth/confirm` (`verifyOtp`), which also works across browsers.
  - Server code identifies users with `supabase.auth.getClaims()`, which verifies the JWT, and never with `getSession()`.
  - Next.js 16's `proxy.ts` (formerly middleware) refreshes sessions and makes an early redirect check. Pages still call `requireUser()`.
  - Post-login redirects accept only same-site relative paths (`safeNextPath`, unit-tested against open-redirect payloads).

## ADR-013: One `.env` at the repo root

- **Status:** Accepted (M0)
- **Decision:** `next.config.ts` loads the root `.env` through `@next/env`, and the worker and migration scripts use `tsx --env-file-if-exists=../../.env`. One file to fill in, and env validation runs in each app.

## ADR-014: Free-tier constraints (checked 2026-10-13)

- **Status:** Accepted (M0); re-check at each milestone
- **Findings** (from provider docs and search results on the date above):
  - Vercel Hobby: cron jobs run at most once per day, and the plan is for non-commercial use. Sources: vercel.com/docs/cron-jobs/usage-and-pricing, vercel.com/docs/plans/hobby.
  - Supabase Free: projects with low activity over 7 days are paused. Source: supabase.com/docs/guides/platform/free-project-pausing. Built-in auth email is rate-limited and meant for testing; production needs custom SMTP. Source: supabase.com/docs/guides/auth/auth-smtp.
  - Gemini API: free-tier limits are per model and shown in AI Studio. Source: ai.google.dev/gemini-api/docs/rate-limits.
- **Consequences:** all scheduling runs on GitHub Actions, a daily keep-alive pings the app and database, custom SMTP is a pre-launch requirement, and LLM calls (from M1) are cached, rate-limited, and degrade gracefully.

## ADR-015: Keep pnpm 11's minimum-release-age guard

- **Status:** Accepted (M0)
- **Decision:** pnpm 11 refuses packages published very recently, which protects against compromised releases. Packages we deliberately take at a fresh version are listed in `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. Only `esbuild` may run install scripts (`allowBuilds`).

---

## Evaluation baselines

There are no baselines yet. The eval set (`data/eval/`) and `pnpm eval` thresholds arrive with M3 (quote validity) and M5 (precision@10, eligibility false-negative rate). Numbers will be recorded here when they're first measured.

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
- **Decision:** `next.config.ts` loads the root `.env` with Node's `process.loadEnvFile` (variables already set in the environment win; `@next/env` can't be used because Next caches its first load from `apps/web`), and the worker and migration scripts use `tsx --env-file-if-exists=../../.env`. One file to fill in, and env validation runs in each app.

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

## ADR-016: Queued résumé extraction and safe replacement

- **Status:** Accepted (M1)
- **Decision:** Upload requests store and register the file plus a queue job atomically in Postgres; parsing/provider
  work happens only in `worker extract-resumes`. A five-minute GitHub schedule is opt-in. The UI polls a small
  authenticated status endpoint. User-facing file/profile writes remain under RLS, even inside owner queue transactions.
- **Replacement:** The profile references its newest upload. A worker checks that reference under a row lock before
  replacing the draft. Existing entries survive failed extraction. Optimistic revisions prevent stale editor saves;
  saving is blocked while the current file is processing.
- **Trade-off:** GitHub schedules can be delayed and private-repository minutes are limited. Small deployments can
  run the worker manually. Original file history is retained until deletion; automated pruning arrives in M7.

## ADR-017: Conservative redaction, verified quotes, explicit confirmation

- **Status:** Accepted (M1)
- **Decision:** Drop résumé headers and contact/address lines, redact common embedded PII, and fail closed when there
  is no recognizable section heading. Contact URLs are recovered locally, not by an LLM. Provider output is Zod-validated;
  verbatim quotes and row identities must occur in the source. Unsupported bullets and skill claims are dropped.
  Skill tiers derive from verified work/project/course evidence, not the model's requested tier.
- **Confirmation:** Every extracted row starts unconfirmed. Users can correct all fields; changed rows lose their
  original quote, and manually added/changed skills become self-declared. Profile confirmation requires at least one
  entry and a confirmation for every entry.
- **Limits:** Header/contact detection is heuristic. It can reject unusual layouts or remove legitimate address-related
  prose; it cannot guarantee removal of names embedded in arbitrary prose. Live testing with a paid/no-training
  provider and three real-world layouts remains required before declaring M1 acceptance complete.

## ADR-018: AI SDK providers, scoped cache, and global request budgets

- **Status:** Accepted (M1)
- **Decision:** `packages/llm` uses the Vercel AI SDK with Gemini as default and OpenAI as an env-selected alternative.
  Cache keys include user, provider, model, prompt version, and redacted text. Cache entries expire logically after
  30 days. Atomic Postgres counters bound requests per minute/day across worker instances. Input is limited to
  40,000 characters and output to 8,000 tokens; each provider call times out after 60 seconds.
- **Fallback:** Invalid quotes are removed. More than 30% invalid entries triggers one regeneration; a draft with no
  verified evidence fails with a manual-entry prompt. Provider/quota failures remain queued until retries are exhausted.
- **Testing:** Real parsers process three synthetic layouts. Unit/integration tests inject provider responses; browser
  tests use isolated signed-JWT auth, private-file storage, and a synthetic provider. No auth bypass exists in the app.
- **Test-host limit:** Local browser tests run serially and explicitly drive the worker after uploads commit.
  PGlite's socket server shares unnamed prepared statements across connections and cannot reliably support
  concurrent extended-query sessions. Production Postgres does not have this limitation.
- **Scale-up:** `ResumeStorage` isolates Supabase Storage; new storage adapters or AI SDK provider adapters can replace
  the current hosts without changing the profile pipeline.
- **Dependency audit:** Omit Mammoth 1.13.0's unused CLI-only `argparse` dependency, which brings in vulnerable
  `sprintf-js` (GHSA-hp3w-g68c-fv3c). The advisory lists 1.1.4 as patched, but the registry has not published it.
  Mammoth's library API does not import argparse and remains covered by parser tests. The standalone `mammoth`
  CLI is intentionally unsupported; use the project's worker. Remove this scoped override when upstream fixes
  its dependency. No advisory is suppressed.

---

## ADR-019: Deterministic hard filters, and unknown never excludes

- **Status:** Accepted (M2)
- **Context:** Excluding a job the candidate actually qualifies for is the worst failure for a job-search tool.
  Job descriptions often omit work mode, job type, or pay, and candidates often leave answers empty.
- **Decision:** `evaluateJobEligibility(candidate, job, today)` in `packages/core` is pure code with no LLM. Each
  preference filter (role, work mode, city, job type, salary) and each stated requirement (`hardRequirementSchema`,
  one structured value per `eligibility_kind`) returns met, unmet, or check with a plain-language message.
  Requirement checks keep the job description's verbatim quote. A job is excluded only when a known value fails;
  anything missing, unstated, or unrecognized becomes a check. M3 (pasted jobs) and M5 (discovery) call the same
  function, and `parseHardRequirement` returns null for malformed stored rows so they are skipped, not trusted.
- **Specific rules:** remote jobs are never filtered by city; salary compares only published INR annual or monthly
  pay, never internship stipends, and a job passes when its published maximum meets the floor; CGPA and
  percentage are compared only on the same type and scale, because conversions vary by university; a higher degree
  than asked is a check, not a pass. Experience comes from dated paid work in a confirmed profile, with overlapping
  roles counted once; `SCORING_CONFIG.eligibility.experienceGraceMonths` (6) turns near misses into checks.
- **Trade-off:** more jobs show checks than a strict filter would allow. That is deliberate: the M5 eval will measure
  the eligibility false-negative rate, and checks are visible rather than silent.

## ADR-020: Small curated vocabularies for cities, degrees, and branches

- **Status:** Accepted (M2)
- **Decision:** `packages/core/src/terms.ts` maps common spellings to canonical keys: Indian cities (Bangalore →
  Bengaluru, Gurgaon → Gurugram), degrees with levels (BTech, B.E., MCA, and others), and branches (CSE, IT, ECE).
  Matching normalizes punctuation and tries the longest alias first, so "Electrical and Electronics Engineering"
  is not mistaken for Electronics. Preferences are normalized on save, so stored values are already canonical.
- **Why not an LLM or embeddings:** filters must be deterministic, explainable, and cheap to run on every job. A term
  missing from the list is unrecognized, which makes it a check under ADR-019, never an exclusion.
- **Revisit:** extend the lists from real job-description data in M4 and M5.

## ADR-021: Preferences storage, revisions, and the availability kind

- **Status:** Accepted (M2)
- **Decision:** One `preferences` row per user (unique on `user_id`). `savePreferences` validates with
  `preferencesSchema`, normalizes, and checks an optimistic revision (the loaded `updated_at`, or null for the first
  save) under a row lock, rejecting stale tabs like the profile editor does. Reads skip the cross-field rules (at least one
  role, job type, and city), so a row saved before such a rule existed still loads. Salary is stored in rupees and edited in LPA.
- **Schema changes:** migration `0003` adds `availability` to `eligibility_kind` for joining-deadline requirements.
  Work authorization stays in the existing `text` column and is validated by Zod (`authorized`,
  `needs_sponsorship`), so adding statuses later needs no migration.

## ADR-022: Preview filters on made-up example postings

- **Status:** Accepted (M2)
- **Context:** M2 is done when preferences are "reflected in filters", but real jobs don't exist until M3 and M4.
- **Decision:** The review step and Settings run the live, unsaved answers through `evaluateJobEligibility` on six
  clearly labeled example postings in `apps/web/src/app/preferences/example-jobs.ts`, plus a plain-language list of
  every rule (`describeFilters`). The preview uses the production function, not a copy.
- **Trade-off:** examples are fixed, so they can't show every rule. A unit test checks that every example
  requirement passes the schema and that a typical fresher's answers produce all three outcomes.

---

## ADR-023: Deterministic match scoring and relevance bands

- **Status:** Accepted (M3)
- **Decision:** `scoreMatch` in `packages/core/src/matching.ts` is pure code; the model never picks a band.
  - Each skill requirement takes the weight of the strongest confirmed evidence for it (`SCORING_CONFIG.evidenceWeights`:
    paid work 1.0, internship 0.9, project 0.7, coursework or certification 0.5, self-declared 0.3, none 0).
    Core coverage is the mean over core skills, or over nice-to-haves when a posting lists no core skills.
  - Bands: **Strong** needs coverage ≥ 0.8 *and* responsibility similarity ≥ 0.55; **Good** ≥ 0.6; **Partial** ≥ 0.4;
    otherwise **Low**. **Not eligible** only when a hard requirement fails on a known value (ADR-019).
  - Similarity is the cosine of two embeddings: confirmed experience and project text, and the posting's
    responsibility and core-skill quotes. Both sides are masked first. Vectors are cached by model and content hash,
    so re-checks and gap answers don't re-embed unchanged text. If embedding fails, similarity is null and the job
    can't be Strong; it never blocks a match.
  - Preference mismatches (city, salary, job type) show as checks and lower the internal ordering score
    (0.6 coverage, 0.3 similarity, 0.1 preferences), but never hide a job the user chose to paste.
- **Why:** bands must be explainable line by line and stable across runs. Users see bands and the evidence behind
  each, never the number, and the band text says it describes fit, not the chance of being hired.
- **Trade-off:** without embeddings (keyword mode, or an embedding failure) Strong is unreachable. The keyword
  baseline below shows this. Weights are spec defaults; retune them against `data/eval` and record the result here.

## ADR-024: Requirements are read once, with verified quotes, and a keyword reader as fallback

- **Status:** Accepted (M3)
- **Decision:** Pasted text is normalized (`cleanJobText`: NFKC, zero-width characters removed, tidy whitespace) and
  must be 200–30,000 characters. Recruiter emails and phone numbers are masked before any provider call, and
  requirement quotes are verified against that masked text. The model returns flat, nullable eligibility fields;
  code builds the strict `hardRequirementSchema` value, so malformed rows become "unclear", never exclusions.
  Requirements whose quote isn't in the text are dropped. If under 70% verify, extraction is retried once and the
  better attempt kept. A posting with no verified requirements fails with a message asking for the full description.
  Skills are normalized against a curated vocabulary of 67 skills (`packages/core/src/skills.ts`).
- **Keyword reader:** with no usable LLM settings, `keywordJobExtraction` finds vocabulary skills line by line and
  quotes the line that names each one. Optional wording ("a plus", "preferred", or a "Nice to have" heading) is
  judged per clause. It never reads eligibility, so it can't exclude a job. A job read by keywords is read again
  by the model on its next re-check once a provider is configured.
- **Why:** the product works on day one without an API key, and every requirement the user sees points at text
  that is really in the posting.

## ADR-025: The model writes prose only; the server verifies every quote

- **Status:** Accepted (M3)
- **Decision:** The explanation prompt gives the model the requirements (R1, R2, ...), the deterministic match, and
  masked confirmed evidence. It returns a summary plus strengths, gaps, and checks, each tied to a requirement and
  a quote. `verifyExplanation` checks résumé quotes against the masked evidence and job quotes against the masked
  posting. If more than 30% fail (`SCORING_CONFIG.explanations.maxQuoteFailureRate`), the explanation is
  regenerated once. If it still fails, or the provider errors or hits its quota, the page shows the structured
  overlap built from the deterministic match: strengths, gaps, and checks with real quotes, but no prose.
- **Gap answers:** "I have this" adds a confirmed, self-declared skill (origin `gap_prompt`, weight 0.3) or confirms
  an existing unconfirmed one. "I don't have this" removes only skills added that way. Either answer re-scores
  without calling a model: similarity is reused while the compared text is unchanged, stored model output is
  re-verified against the new evidence, and the summary is dropped when the evidence changed, because it can no
  longer be checked.
- **Why:** an explanation that cites text which doesn't exist is worse than no explanation.

## ADR-026: Job links are fetched once, politely, and never from blocked sites

- **Status:** Accepted (M3)
- **Decision:** `packages/connectors` fetches a link only when a user submits it. The User-Agent is
  `FitwiseBot/0.3 (+<site>/bot)`, and `/bot` explains what the bot does and how to opt out.
  - LinkedIn, Naukri, Indeed, Glassdoor, and foundit are refused before any request, because their terms prohibit
    automated access.
  - robots.txt is checked for the origin and for every redirect target (RFC 9309: 4xx means allowed; 5xx or
    unreachable means disallowed). Rules are cached for an hour, or five minutes after a failure.
  - Only `http(s)` links on the default port, without credentials, are allowed. On every hop, the request is refused
    if any resolved address is private. No cookies are sent. Limits: 10 seconds, 3 MB after decompression, and at
    most five redirects.
  - Extraction prefers JSON-LD `JobPosting` data and falls back to Readability.
  - Fetched pages are cached for 24 hours in `job_postings` (source `user_url`, keyed by a hash of the URL, no
    user ID), so one cache serves every user.
  - Failures are never retried automatically. The form switches to paste mode, keeps the link, and explains why.
  - Rate limits: 10 link fetches per user per hour, on top of 10 added jobs per hour and 30 per day.
- **Why:** a candidate tool must not become a scraper. Paste always works.

## ADR-027: Analyse right after the request, with a scheduled sweep as backup

- **Status:** Accepted (M3)
- **Context:** Vercel Hobby cron runs at most daily (ADR-014), and GitHub schedules can be delayed by many minutes.
  Waiting for a worker would make "paste a job" feel broken.
- **Decision:** Adding or re-checking a job enqueues a `job.analyze` run in the same transaction as the job row, then
  calls Next.js `after()` to claim and process that run once the response is sent (routes allow 300 seconds). The page
  polls a status endpoint, and each poll also tries to claim a due queued run, so retries after a provider error
  happen while the user watches. Claiming is atomic, so repeated polls are harmless. Runs lease for 300 seconds. If
  the process dies, the lease expires and the run is picked up again.
- **Backup:** `pnpm worker analyze-jobs` drains up to 10 due runs. `analyze-jobs.yml` runs it every 15 minutes when
  the repository variable `ANALYZE_JOBS_WORKER` is `true`. It is off by default.
- **Trade-off:** the web app needs the LLM settings for model-quality analysis. Without them both paths use the
  keyword reader.

## ADR-028: Evaluation set and gates

- **Status:** Accepted (M3)
- **Decision:** `data/eval/` holds 12 synthetic Indian fresher job descriptions (four each for backend, frontend,
  and data analyst) and six synthetic profiles. `jobs.json` labels each posting's core skills, nice-to-haves, and
  eligibility kinds, plus the expected band for two profiles. `pnpm eval` analyses all 24 pairs on a fresh in-memory
  database using the production pipeline, prints per-job and per-pair tables, and exits non-zero below the gates:
  - **Model mode** (an LLM key is set): extraction quote validity ≥ 90%, explanation quote validity ≥ 90%, and
    ≥ 90% of explanations verified (not fallback).
  - **Keyword mode** (no key): extraction quote validity 100% and skill recall ≥ 90%.
  Band agreement is reported but not gated, because the expected bands are one person's judgment.
- **Where it runs:** CI runs keyword mode on every push. `eval.yml` runs model mode on demand with `--require-model`,
  which fails instead of silently falling back when the key is missing. Each model run makes at least 36 provider
  requests (12 extractions and 24 explanations), plus one for each regeneration.
- **Limits:** the postings are written for the eval, not collected from real listings, and the labels have a single
  author. Add real postings with permission in M4 and M5. Standalone profile skills are always self-declared
  (ADR-017), so eval profiles put skills on entries.

## Evaluation baselines

| Date | Mode | Extraction quote validity | Skill recall | Core vs nice-to-have | Explanation quote validity | Band exact / within one |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-14 | Keyword reader, no LLM | 100% (12 jobs) | 98.8% (only Celery missed; not in the vocabulary) | 95.0% | Not measured (structured fallback) | 29.2% / 62.5% (24 pairs) |

Keyword mode can't reach Strong (no similarity) and never excludes, which explains most band disagreements. The
**model-mode baseline (the M3 acceptance gate of ≥ 90% quote validity) has not been measured yet**, because no
provider key was available. Record it here after the first `eval.yml` run. M5 adds precision@10 and the
eligibility false-negative rate.

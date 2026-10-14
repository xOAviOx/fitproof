# Fitwise

> Find jobs that fit your experience, and know what to improve before you apply.

An explainable job-search assistant for final-year students and candidates with 0–2 years of experience in India (Bengaluru, Hyderabad, Pune, and Remote), focused on Backend/Software, Frontend, and Data Analyst roles. Every match links résumé evidence to verbatim job-description quotes, shows relevance as Strong / Good / Partial (never a percentage), and never invents experience.

"Fitwise" is a working name. It is defined once in `packages/core/src/product.ts`.

## Status

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Walking skeleton: monorepo, auth, schema + RLS, CI, health | Supabase database live with migrations applied; CI, nightly e2e, and migrate workflows green on GitHub; **web app not yet deployed to Vercel**, and Supabase auth URLs not yet configured |
| M1 | Résumé → editable profile | Implemented and locally tested with synthetic PDF/DOCX layouts; live provider/storage setup and three real-world résumé checks still pending |
| M2 | Preferences and eligibility | Implemented and locally tested (unit, RLS integration, desktop and mobile e2e). Filters apply to real jobs once they exist (pasted jobs in M3, discovery in M5) |
| M3 | Bring-your-own-job | Implemented and locally tested (unit, integration, keyword-mode eval, desktop and mobile e2e). The model path works live with Gemini, but **acceptance isn't met yet**: the first model eval stopped at the free tier's 20 requests per day, with half the set done (see "Evaluation baselines" in `docs/DECISIONS.md`) |
| M4 | Job collection (ATS connectors, Adzuna) | Not started |
| M5 | Discovery and ranking | Not started |
| M6 | Tailoring and résumé versions | Not started |
| M7 | Hardening, backups, Docker images | Not started |

## Architecture

```
apps/web             Next.js 16 (App Router): UI, auth, route handlers, server actions
apps/worker          CLI pipelines run by GitHub Actions (selftest, extract-resumes, analyze-jobs, storage-setup) and the eval runner
packages/core        Pure domain logic and config, no I/O (vocabularies, scoring, eligibility, quote verification, prompts)
packages/db          Drizzle schema, migrations, RLS policies, job queue, PGlite test harness
packages/llm         AI SDK provider adapters, user-scoped caching, quotas, extraction, explanations, embeddings
packages/analysis    The job analysis pipeline shared by the web app, the worker, and the eval
packages/connectors  Polite, SSRF-safe fetching of user-supplied job links
packages/storage     Private résumé storage behind a replaceable interface
data/eval/           Synthetic job descriptions, profiles, and labels for `pnpm eval`
docs/                DECISIONS, RUNBOOK, PRIVACY, BACKLOG
```

- **Database:** Supabase Postgres with pgvector. Every table has Row Level Security enabled. App queries run through `withUserContext()`, which switches to Supabase's `authenticated` role inside a transaction, so RLS applies to the app's own queries and not only to the Supabase Data API.
- **Auth:** Supabase Auth (email magic link and Google OAuth) via `@supabase/ssr`. `src/proxy.ts` refreshes sessions and redirects anonymous visitors away from protected pages.
- **Background work:** the `job_runs` table is the queue (lease-based claiming with retries). `packages/db/src/queue.ts` is the only module that knows this, so moving to a managed queue later means rewriting just that file.
- **Validation:** Zod at the boundaries. Both apps refuse to start if required environment variables are missing.

See `docs/DECISIONS.md` for the reasoning behind each choice.

## Résumé and profile (M1)

Open `/profile` after signing in. You can create a profile manually even without storage or LLM configuration.
Skills, work, internships, projects, education, certifications, summary, and contact links are editable.
Review each evidence entry, check its confirmation box, then choose **Confirm profile**. Edits return the profile
to draft. Manually added or changed skills are self-declared; changed entries no longer claim an original résumé quote.

To enable upload and background extraction:

1. Set `SUPABASE_SECRET_KEY` to a server-only Supabase secret (or legacy service-role key), and set the worker's
   `GEMINI_API_KEY`, `LLM_PROVIDER`, and `LLM_MODEL`. Before processing real personal data, use a paid/no-training
   provider tier. To switch providers, set `LLM_PROVIDER=openai`, an OpenAI `LLM_MODEL`, and `OPENAI_API_KEY`.
2. Run `pnpm worker storage-setup` once to create/configure the private `resumes` bucket. This is an operator
   command that changes Storage settings; it is never run by the app or tests.
3. Set `RESUME_UPLOADS_ENABLED=true` in the web environment. Upload a text-based PDF or DOCX, at most 5 MB.
4. Run `pnpm worker extract-resumes` locally to process queued uploads. In GitHub, configure the secrets
   `DATABASE_URL`, `SUPABASE_SECRET_KEY`, and your provider key, plus repository variables
   `RESUME_UPLOADS_ENABLED=true`, `NEXT_PUBLIC_SUPABASE_URL`, and the LLM model/provider settings.
   `extract-resumes.yml` runs every five minutes when enabled, or can be run manually.

The upload request only stores and queues the file. The worker parses it, removes contact information, obtains
a structured draft, verifies quotes, and saves the result. The page polls status and updates automatically.
GitHub schedules can be delayed. Re-uploading replaces the draft only after successful extraction; an older
worker result cannot overwrite a newer upload. Failed files show a helpful error and still allow manual edits.
Unrecognized section headings fail closed rather than sending an unredacted document to the provider.

Limits: five uploads per user per hour, 40,000 extracted characters, 30 PDF pages, 20 MB expanded DOCX data,
and configurable global LLM request budgets. Original files are accessed through 60-second signed URLs after an
ownership check. Uploads remain off by default so M0 environments continue to start without new secrets.

## Preferences and eligibility (M2)

After signing in, the dashboard links to `/preferences`, a five-step setup: roles and job types, work mode and
cities, pay and availability, education and eligibility, and a review. `/settings` edits the same answers on one
page. Roles and job types are required, and so is at least one city unless you choose remote only. Everything else
is optional. Education is prefilled from your profile until preferences are first saved.

Filters are deterministic code in `packages/core/src/eligibility.ts`, with no LLM involved. The rule is that
**unknown never excludes a job**: a job is filtered out only when a known fact fails, for example a Pune office
job when you chose Bengaluru and aren't open to relocating. Missing answers, unstated job details, and
unrecognized terms become checks that show beside the job. The review step and Settings show every rule in plain
language and run it on six made-up example postings, so you can see what changes before you save. Real postings
use the same function from M3 on.

- **Preference filters:** role family, work mode, city (relocation-aware; remote jobs are never filtered by city),
  job type, and minimum salary (only published INR annual or monthly pay; internship stipends never filter).
- **Requirements compared with the job description:** graduation batch, degree level and branch, CGPA or
  percentage (same type and scale only), work authorization for India, joining deadline, and years of experience
  (from dated paid work in a confirmed profile, with a six-month grace that shows a check instead of excluding).

Saves are rate-limited and use the same optimistic revision check as the profile, so a stale tab cannot overwrite
newer answers.

## Bring your own job (M3)

Choose **Check a job** on the dashboard (or open `/jobs/new`). Paste a job description, or use a link to the
posting. The job page then shows:

- **A relevance band:** Strong, Good, Partial, Low, or Not eligible. Code computes it from your confirmed evidence,
  never a model, and it is never shown as a percentage (ADR-023).
- **Where you match, gaps to close, and checks.** Each item quotes the posting and, for matches, your profile.
  **Show in context** highlights both quotes side by side in the posting and your evidence.
- **Gap answers.** "I have Docker" adds Docker to your profile as a self-declared skill and re-scores at once.
  "I don't have Docker" removes only a skill added that way.
- **Save to tracker.** `/tracker` lists saved jobs with a status (Saved, Applied, Interviewing, Offer, Rejected,
  Withdrawn), notes, and a next-action date.

Analysis starts right after you add a job, and the page updates when it finishes (ADR-027). With LLM settings,
a model reads the requirements and writes the explanation. Every quote it returns is checked against the posting
and your profile, and it is regenerated once if more than 30% fail; after that the page shows only the overlap
that code verified (ADR-025). **Without LLM settings, everything still works:** postings are read by keyword,
with a notice that eligibility rules weren't read (ADR-024).

Links are read by FitwiseBot (`/bot`), which honors robots.txt and never contacts LinkedIn, Naukri, Indeed,
Glassdoor, or foundit. If a link can't be read, the form switches to paste and keeps the link (ADR-026).
Limits: 10 added jobs per hour and 30 per day, 10 link reads per hour, and 200–30,000 characters per description.

To use a model for jobs on Vercel, add `GEMINI_API_KEY` (or the OpenAI settings), `LLM_PROVIDER`, `LLM_MODEL`, and
optionally `LLM_EMBEDDING_MODEL`, `LLM_RPM`, and `LLM_DAILY_REQUESTS` to the web project, then redeploy. The
optional backup sweep is described in `docs/RUNBOOK.md`.

## Prerequisites

- Node.js 22.12+ (`.nvmrc` pins 22) and pnpm 11 (`corepack enable` picks up the pinned version)
- A free [Supabase](https://supabase.com) project
- A free [Vercel](https://vercel.com) account (Hobby is for non-commercial use; see "Scaling up")
- Docker is **not** required. Database tests run on PGlite (Postgres compiled to WASM).

## Local setup

```bash
pnpm install
cp .env.example .env        # then fill in the values (see "Supabase setup")
pnpm db:migrate             # applies migrations using DATABASE_MIGRATION_URL
pnpm dev                    # http://localhost:3000
```

### Supabase setup (about 10 minutes)

1. **Create a project.** Pick the region closest to your users (Mumbai, `ap-south-1`, for India).
2. **Connection strings.** Go to Dashboard → **Connect** and copy:
   - the **Transaction pooler** URI (port 6543) into `DATABASE_URL`
   - the **Session pooler** URI (port 5432) into `DATABASE_MIGRATION_URL`

   Use the poolers rather than the direct connection, because the direct host is IPv6-only on the free plan and GitHub Actions runners only have IPv4.
3. **API keys.** Under Project Settings → **API Keys**, copy the project URL into `NEXT_PUBLIC_SUPABASE_URL` and the publishable key into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. **Apply migrations.** Run `pnpm db:migrate`. This creates the `vector` extension, all tables and RLS policies, and a trigger that mirrors `auth.users` into `public.users`.
5. **Auth URLs.** Under Authentication → **URL Configuration**:
   - Site URL: your production URL (or `http://localhost:3000` while developing)
   - Redirect URLs: `http://localhost:3000/**` and `https://<your-vercel-domain>/**`
6. **Magic-link email template (recommended).** Under Authentication → **Emails → Magic Link**, set the link to:
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard
   ```
   This lets the link work even when it's opened in a different browser from the one that requested it. The default template also works (through `/auth/callback`), but only in the same browser.
7. **Google sign-in (optional).** Create an OAuth client in Google Cloud Console (type: Web), add `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI, then enable the Google provider in Authentication → **Providers** with that client ID and secret.
8. **Email delivery before inviting anyone.** Supabase's built-in email service is heavily rate-limited and meant for testing. Configure custom SMTP under Authentication → **Emails → SMTP Settings** before real users sign up. Resend's free tier works, and no code change is needed.
9. **Optional hardening.** The app never uses the Supabase Data API (PostgREST). You can remove `public` from the exposed schemas under Project Settings → **Data API**. RLS protects the tables either way.

## Deploy to Vercel

1. Push this repo to GitHub, then in Vercel choose **Add New → Project** and import it.
2. Set **Root Directory** to `apps/web`. The framework preset (Next.js) and pnpm are detected automatically.
3. Add these environment variables for Production and Preview: `DATABASE_URL`, `DATABASE_POOL_MAX` (optional), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL` (your Vercel URL). Also add `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel installs the pnpm version pinned in the root `package.json` instead of guessing from the lockfile.
   Under Settings → **Functions**, set the function region to Mumbai (`bom1`) so the server runs next to the database. New projects default to Washington, D.C. (`iad1`), which adds roughly 200 ms to every database round trip.
4. Deploy, then open `https://<your-domain>/api/health`. It should return `{"status":"ok", ...}`.
5. Add the deployed URL to the Supabase redirect URLs (step 5 above).

## GitHub Actions configuration

| Name | Kind | Used by |
| --- | --- | --- |
| `APP_URL` | Repository variable | `keepalive.yml`: daily health ping, which keeps the Supabase project from pausing |
| `DATABASE_URL` | Secret | `keepalive.yml` worker selftest (and the scheduled ingest jobs from M4) |
| `DATABASE_MIGRATION_URL` | Secret, in a `production` environment | `migrate.yml`: applies migrations when `packages/db/migrations` changes on `main` |
| `GEMINI_API_KEY` or `OPENAI_API_KEY` | Secret | `extract-resumes.yml`, `analyze-jobs.yml`, and `eval.yml` |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_EMBEDDING_MODEL`, `LLM_RPM`, `LLM_DAILY_REQUESTS` | Repository variables (optional) | The same three workflows. Defaults: `gemini`, `gemini-2.5-flash`, the provider's embedding model, 5, and 100 |
| `ANALYZE_JOBS_WORKER` | Repository variable | Set to `true` to enable the 15-minute `analyze-jobs.yml` backup sweep |

Workflows:

- `ci.yml` runs lint, typecheck, unit and integration tests (including the RLS isolation suite), the keyword-mode eval, build, and a dependency audit on every PR and every push to `main`.
- `nightly.yml` runs the Playwright e2e suite against a production build.
- `keepalive.yml` runs daily.
- `migrate.yml` runs on migration changes, or on demand.
- `analyze-jobs.yml` finishes job analyses the web app couldn't (off unless `ANALYZE_JOBS_WORKER=true`).
- `eval.yml` runs the model eval on demand and fails below the quote-validity gates. Each run spends provider quota.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the web app locally |
| `pnpm lint` / `pnpm format` | Check / fix lint and formatting (Biome) |
| `pnpm typecheck` | Strict TypeScript across all packages |
| `pnpm test` | Unit and integration tests (Vitest; DB tests use in-memory PGlite) |
| `pnpm build` | Production build (requires env vars) |
| `pnpm test:e2e` | Playwright smoke tests against a production build. Run `pnpm build` first. Set `PW_CHANNEL=chrome` to use an installed Chrome instead of downloading Chromium |
| `pnpm db:generate` | Generate a migration after editing `packages/db/src/schema` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm worker selftest` | Check worker → database connectivity and record a run |
| `pnpm worker storage-setup` | Operator-only: provision a private résumé bucket |
| `pnpm worker extract-resumes` | Process up to five queued résumé uploads |
| `pnpm worker analyze-jobs` | Process up to 10 queued job analyses |
| `pnpm eval` | Run `data/eval` and check the gates: keyword mode without an LLM key, model mode (spends quota) with one. `--only <prefix>` runs a subset; `--require-model` fails without a key. Model runs save responses and resume after a spent daily quota; `--fresh` starts over |
| `pnpm --filter @repo/db pglite:serve` | In-memory Postgres on port 54329, for smoke-testing without Docker or Supabase (no auth) |

## Free-tier constraints (checked 2026-10-13; re-check before relying on them)

- **Vercel Hobby:** non-commercial use only, short function durations, and cron at most once a day. Long or scheduled work runs in the worker on GitHub Actions.
- **Supabase Free:** projects pause after 7 days of low activity (the keep-alive workflow prevents this), limited database and storage size, and no point-in-time recovery. A nightly encrypted `pg_dump` workflow arrives in M7.
- **Gemini free tier (from M1):** per-model request limits shown in Google AI Studio, and inputs may be used to improve Google's products. A paid tier or a no-training provider is required before onboarding real users (see `docs/PRIVACY.md`).
- **GitHub Actions:** scheduled runs can be delayed, so every pipeline is idempotent and resumable.

## Scaling up without a rewrite

The database is plain Postgres plus pgvector, so it runs on any Postgres host. The LLM provider is selected by environment variable. File storage sits behind `ResumeStorage`. The queue lives in one module. Dockerfiles for `web` and `worker` ship in M7 and will be verified by building both images locally. Before charging users, move to Vercel Pro or run the web image on any container host, and move to a paid or no-training LLM tier.

### M1 verification

Unit/integration tests exercise real PDF/DOCX parsers with single-column, two-column, and table-based synthetic
résumés, redaction, quote verification, provider caching/quotas, RLS profile persistence, stale results, and retries.
Playwright exercises upload → background extraction → edit → confirm → reload, manual entry, re-upload,
errors, and cross-user download isolation on desktop and mobile. Its auth service signs local test JWTs; the
production app still verifies them normally. Storage and provider responses are mocked locally, with no real
provider calls, auth bypass, or real résumé data. The fit/eligibility evaluation command arrives in M3/M5.

Manual acceptance check after live setup:
1. Sign in and upload three different real-world résumé layouts (PDF and DOCX), using a paid/no-training provider.
2. Wait for each draft, compare every section to its source, and correct dates, evidence tiers, or fields as needed.
3. Confirm every entry, save, reload, and check that it remains confirmed.
4. Re-upload a different résumé and check that its successful draft replaces the old entries.
5. Sign in as another user and check that the first user's profile and original-file URL are inaccessible.

### M2 verification

Unit tests cover city, degree, and branch matching, preference validation and normalization, every filter and
requirement kind, and the "unknown never excludes" rule. Integration tests check RLS-scoped save and load, stale
revisions, and normalization on PGlite. Playwright runs on desktop and mobile: wizard validation and focus,
persistence after reload, Settings edits changing the live preview, stale-tab rejection, education prefill from an
extracted résumé, sign-in redirects, and no horizontal scrolling.

Manual acceptance check:
1. Sign in and choose **Set your preferences** on the dashboard. Choose **Continue** with nothing selected; an error
   appears and focus moves to the first role.
2. Choose Backend, Full-time, Hybrid or remote, Bengaluru, not open to relocating, 6 LPA, a 30-day notice period,
   2025, B.Tech, Computer Science, CGPA 8.2 out of 10, and authorized to work in India.
3. On the review step, check the examples: "Backend Engineer, New Grad" is shown with an experience check (until your
   profile is confirmed), and "Data Analyst", "Software Engineer II" (Pune), and "Backend Developer (Contract)" are
   filtered out with a reason.
4. Save, reload, and check that every answer persists and the dashboard card summarizes it.
5. In Settings, switch relocation to **Yes**. "Software Engineer II" changes to shown with checks before you save.
   Save and reload.
6. Open Settings in two tabs, save in one, then save in the other. The second shows a "changed in another tab" error.
7. Confirm a profile with dated work entries and check that the Experience rule shows your months of experience.

### M3 verification

Unit tests cover the skill vocabulary, job text cleaning and contact masking, extraction and explanation quote
verification, the keyword reader, deterministic scoring and bands, highlight offsets, JSON-LD and Readability
extraction, and link fetching against a local test server (SSRF protection, redirects, decompression, robots.txt
rules, and blocked sites, including after a redirect). Integration tests on
PGlite cover job creation and deduplication, RLS-scoped loading, gap answers, the tracker, the link cache, and the
full pipeline with injected provider responses: regeneration on failed quotes, structured fallback, provider
errors, re-scoring after a gap answer without a model call, and masking of profile contact details before
embedding. Playwright runs on desktop and mobile with no LLM key (keyword mode): paste → quoted matches and gaps →
side-by-side highlight → gap answer and undo → save → tracker edits persist; a LinkedIn link switches to paste; and
another user gets "Page not found" and a 404 from the status API.

`pnpm eval` (keyword mode, 2026-10-14): extraction quote validity 100%, skill recall 98.8%. Band agreement is 29.2%
exact and 62.5% within one band, because keyword mode can't reach Strong. See "Evaluation baselines" in
`docs/DECISIONS.md`. A first model run (Gemini free tier) covered 6 of 12 postings before the daily quota ran out:
extraction quote validity 100%, and the 9 explanations that came back were all verified (96.4% quote validity).
**The model gate has not been met on a complete run**, so M3 acceptance is still open.

Manual acceptance check (after adding a provider key to `.env` or the web project):
1. Run `pnpm eval --require-model` with the key set, or the **Model eval** workflow. It must print `PASS`. On a
   free-tier key it prints `PAUSED` when the daily quota runs out; run it again the next day until it finishes
   (`docs/RUNBOOK.md`). Record the numbers in `docs/DECISIONS.md`.
2. Confirm a profile with at least one internship or project that lists real skills. Open **Check a job**, paste a
   real fresher posting, and choose **Check this job**. Within about a minute the page shows a band, a summary, and
   quoted matches and gaps. No "Read without AI" notice appears.
3. For one match, choose **Show in context**. The same line is highlighted in "The posting" and in "Your evidence".
   Search the original posting for two quotes and check they appear word for word.
4. On a gap, choose **I have …**. The skill moves to "Where you match" as a self-declared skill, and `/profile`
   lists it. Choose **I don't have …** to undo it.
5. Add a job by link from a company careers page (for example a Greenhouse or Lever posting). It loads. Then try a
   LinkedIn link: the form explains why, switches to paste, and keeps the link.
6. Choose **Save to tracker**, open the tracker, set the status to Applied, add a note and a date, save, and reload.
7. Sign in as another user and open the first user's job URL. It shows "Page not found".
8. Try nine more postings across backend, frontend, and data analyst roles. Note any quote that isn't in the
   posting, and any band that looks wrong, in `docs/BACKLOG.md` or as an eval case.

## Docs

- `docs/DECISIONS.md`: architecture decisions and trade-offs (ADRs)
- `docs/RUNBOOK.md`: operating procedures
- `docs/PRIVACY.md`: data handling
- `docs/BACKLOG.md`: ideas deliberately out of scope

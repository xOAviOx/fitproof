# Runbook

Operating procedures. Sections for features that don't exist yet are marked with the milestone that adds them.

## Check that the system is healthy

1. Open `https://<app>/api/health`.
   - `200 {"status":"ok"}`: the web app and the database are reachable.
   - `503 {"status":"degraded","checks":{"database":"error"}}`: the app is up but can't reach Postgres. Check the Vercel function logs for the `health check failed` entry, which includes the underlying driver error.
2. Look at the latest **Keep-alive** workflow run in GitHub Actions. It pings the health endpoint and runs `pnpm worker selftest` daily.
3. If the Supabase project is **paused** (free plan, 7 days of low activity), restore it from the Supabase dashboard. It takes a few minutes. Then re-run the Keep-alive workflow.

## Apply database migrations

- **Automatically:** pushing changes under `packages/db/migrations/` to `main` runs the **Migrate database** workflow. It needs the `DATABASE_MIGRATION_URL` secret, set to the session pooler on port 5432.
- **Manually:** set `DATABASE_MIGRATION_URL` in `.env`, then run `pnpm db:migrate`.
- **Writing a migration:** edit `packages/db/src/schema`, run `pnpm db:generate`, review the SQL, and commit it. For SQL that Drizzle can't express (triggers, extensions), run `pnpm --filter @repo/db exec drizzle-kit generate --custom --name=<name>` and write the SQL by hand. Keep migrations backward compatible with the deployed app. Add columns first, and remove them in a later release.
- If the dashboard shows "Your account record is still being set up", the auth trigger migration (`0002_auth_user_sync`) probably wasn't applied. Run the migrations.

## Re-run a failed worker job

- Scheduled pipelines record every run in `job_runs` with `status`, `attempts`, and `error`. Queued jobs retry automatically with backoff, and a run is marked `failed` after `max_attempts`.
- To re-run a scheduled pipeline, open its workflow in GitHub Actions and choose **Run workflow**. Pipelines are idempotent.
- To retry a failed queued job (from M1), set `status = 'queued', attempts = 0, scheduled_at = now()` on that row.

## Résumé extraction (M1)

- Configure storage/provider credentials and run `pnpm worker storage-setup` before enabling uploads.
- `pnpm worker extract-resumes` claims up to five due jobs, with a four-minute lease and a four-minute batch deadline.
  Retryable failures use exponential backoff. Quota failures wait until the app's quota window resets.
- In GitHub, enable the `RESUME_UPLOADS_ENABLED` repository variable and configure the credentials described in README.
  The **Extract resumes** workflow checks the queue every five minutes; it is off until explicitly enabled.
  Five-minute polling can consume private-repository Actions minutes. Check your account allowance before enabling it;
  run manually or reduce the schedule for low-volume testing.
- A stuck file usually means the workflow is disabled, its secrets are missing, or a provider quota is exhausted.
  Inspect `job_runs` for `kind = 'resume.extract'`. Payloads contain only the file ID; errors are sanitized.
- To retry a terminal failure, reset both the job (`status='queued', attempts=0, scheduled_at=now(), locked_until=null`)
  and its file (`status='uploaded', error=null`). Only retry the file currently referenced by the candidate profile.
  Old jobs are treated as superseded and cannot replace a newer draft.
- An orphan cleanup warning means the upload failed and Storage cleanup also failed. Compare the user's Storage
  folder to their `resume_files.storage_path` rows before removing any orphan object.

## Job analysis (M3)

- Adding or re-checking a job queues a `job.analyze` run, and the web app processes it right after responding
  (ADR-027). The job page polls status, and each poll retries a due run. Nothing else is needed for normal use.
- **Model or keyword mode.** The web app and worker use the model when they have usable LLM settings
  (`GEMINI_API_KEY`, or `LLM_PROVIDER=openai` with an OpenAI `LLM_MODEL` and `OPENAI_API_KEY`). Otherwise they log
  `No usable LLM settings; reading jobs by keyword` and read postings by keyword with structured explanations.
  To use the model on Vercel, add the same LLM variables to the web project, then redeploy.
- **Backup sweep.** Set the repository variable `ANALYZE_JOBS_WORKER=true` to enable `analyze-jobs.yml`, which runs
  `pnpm worker analyze-jobs` every 15 minutes (up to 10 runs per batch). It needs the `DATABASE_URL` secret and the
  same LLM secrets and variables as extraction. Locally, run `pnpm worker analyze-jobs`.
- **A job stuck on "Reading the requirements"** (or "Reading…" in the jobs list). Check `job_runs` for `kind = 'job.analyze'` and the job ID in
  `payload->>'jobId'`. A `queued` run with a future `scheduled_at` is waiting for the provider quota or a retry backoff.
  A `failed` run's `error` is the message the user saw. Users can add the same text again, which re-queues a job
  whose analysis failed.
- **Quota.** Extraction and explanation calls share the `LLM_RPM` and `LLM_DAILY_REQUESTS` budget with résumé
  extraction. Embedding calls have a separate budget with the same limits. One new job costs one extraction call,
  one explanation call, and one embedding call, plus one more for each quote-validity retry. Re-checks reuse the
  stored requirements, cached embeddings, and cached explanations when nothing changed. Set the app limits to your
  provider's real quota: on 2026-10-14, Gemini's free tier allowed only 20 `gemini-2.5-flash` requests per day.
- **Provider failures** are logged as `explanation unavailable` or `job analysis deferred or failed`, with the error
  class, HTTP `status`, and `finishReason`. A 429 is a provider quota, 5xx is a provider outage, and
  `finishReason: "length"` means the response hit the output-token limit.
- **"We couldn't verify a written explanation"** on a job page means the model's quotes failed verification twice,
  or the provider failed or hit its quota. The band and the line-by-line overlap are still computed by code. Run the
  model eval (below) if this becomes common. A "Read without AI" notice means the job was read in keyword mode.
- **Link fetching complaints.** `/bot` describes FitwiseBot and the opt-out. A site can block it in robots.txt with
  `User-agent: FitwiseBot` and `Disallow: /`. To block a site entirely, add its domain to `BLOCKED_SITES` in
  `packages/connectors/src/job-page.ts` and deploy.

## Run the evaluation

- `pnpm eval` runs `data/eval` against the production pipeline on a throwaway in-memory database. With no LLM key it
  runs in keyword mode, which is what CI runs on every push. With a key in `.env`, it uses the model and spends quota.
- For the model gate, run the **Model eval** workflow (`eval.yml`) in GitHub Actions. It uses `--require-model`, so it
  fails if the provider key secret is missing. Record new baselines in `docs/DECISIONS.md`.
- `pnpm eval --only backend` runs a subset without applying the gates. `--json` also prints the summary as JSON.
- **Free-tier keys.** A local model run saves every model response in `apps/worker/.eval-cache/` (git-ignored, one
  file per provider and model). When the provider's daily quota runs out, the run prints `PAUSED` and exits with
  code 2. Run the same command after the quota resets (midnight Pacific time for Gemini). Saved responses are
  replayed without calling the model, so only the remaining requests spend quota. A full run takes two or three
  days on a 20-requests-per-day key. `--fresh` ignores the saved responses and calls the model for everything.

## Rotate keys

| Secret | Where it lives | How to rotate |
| --- | --- | --- |
| Database password | `DATABASE_URL`, `DATABASE_MIGRATION_URL` (Vercel, GitHub, `.env`) | Supabase → Project Settings → Database → Reset password. Update all three places, then redeploy on Vercel |
| Supabase publishable key | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys → create a new publishable key, update Vercel, redeploy, then revoke the old key |
| Google OAuth client secret | Supabase Auth provider settings | Rotate in Google Cloud Console, then paste the new secret into Supabase |
| Gemini API key | `GEMINI_API_KEY` (worker, and the web app from M3) | Create a new key in AI Studio, update the GitHub secret and the Vercel variable, redeploy the web app, then delete the old key |
| Storage secret | `SUPABASE_SECRET_KEY` (web and worker) | Create a new Supabase secret, update both environments, redeploy the web app, then revoke the old key |

## Delete a user on request

- **Today:** note the user's UUID, stop or let their active extraction jobs finish, then delete their folder in the
  private `resumes` Storage bucket. This includes superseded uploads. Then go to Supabase → Authentication → Users
  and choose **Delete user**. Every user-owned row cascades away, including cached LLM outputs.
  M7 adds a self-serve deletion flow and a script that does both.
- Record the request date and completion date in your support log, not in the app database.

## Turn on scheduled job collection (M4)

1. Apply migration `0004_collection` (the **Migrate database** workflow runs it on push to `main`).
2. In GitHub → Settings → Secrets and variables → Actions, make sure `DATABASE_URL` (secret) and `APP_URL`
   (variable, the public site URL the bot's User-Agent links to) are set. For Adzuna, add the secrets
   `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` from developer.adzuna.com. Without them the runs skip Adzuna.
3. Set the repository variable `COLLECT_JOBS` to `true`. `collect.yml` then runs every 6 hours at minute 40.
4. Run **Collect jobs** once by hand (Actions → Collect jobs → Run workflow) and check the summary line in the
   Ingest step log, or `/admin`.
5. To see `/admin`, add your sign-in email to `ADMIN_EMAILS` in the web environment (comma-separated) and redeploy.
   Everyone else gets a 404.

## Add a company to the registry (M4)

1. Find the company's ATS board and token from its careers page: `boards.greenhouse.io/<token>`,
   `jobs.lever.co/<token>` (or `jobs.eu.lever.co`, which needs `"region": "eu"`), `jobs.ashbyhq.com/<token>`, or
   `apply.workable.com/<token>`. SmartRecruiters boards are skipped while its API's robots.txt disallows crawlers.
2. Check the board answers and lists jobs in a target city:
   - Greenhouse: `https://boards-api.greenhouse.io/v1/boards/<token>/jobs`
   - Lever: `https://api.lever.co/v0/postings/<token>?mode=json`
   - Ashby: `https://api.ashbyhq.com/posting-api/job-board/<token>`
   - Workable: `https://apply.workable.com/api/v1/widget/accounts/<token>`
3. Add an entry to `data/companies.seed.json`, keeping slugs sorted:
   ```json
   {
     "slug": "acme",
     "name": "Acme",
     "ats": "greenhouse",
     "boardToken": "acme",
     "careersUrl": "https://acme.example/careers",
     "hq": "Bengaluru, India",
     "locations": ["Bengaluru"]
   }
   ```
   `slug` is lowercase letters, digits, and hyphens. `locations` lists the target places the board hires for
   (`Bengaluru`, `Hyderabad`, `Pune`, `Remote`). `pnpm --filter @repo/worker test` checks the file.
4. Read just that board: `pnpm worker ingest --company acme`, or run **Collect jobs** with `companies: acme`.
   The log line `board read` shows how many postings were listed and kept. A failure is in `/admin` under
   **Failing boards**.
5. To stop reading a company, set `"active": false` and a `"note"` saying why. Its jobs stay, and close as usual.

## Re-run or debug collection (M4)

- `pnpm worker ingest` reads every board (least recently read first) and searches Adzuna if a day has passed.
  `--company <slug>` (repeatable) reads only those boards and skips Adzuna; `--no-adzuna` skips Adzuna only.
  `pnpm worker verify` closes Adzuna ads unseen for 7 days, re-checks links users added, and prunes old postings.
  Both need `DATABASE_URL` and `NEXT_PUBLIC_SITE_URL`.
- A run that hits the 25-minute budget reports `stopped at the time budget`; the next run starts with the boards it
  didn't reach. Re-running is always safe: postings are upserted, and a run already in progress makes a new one exit.
- A run killed mid-way stays `running` in `job_runs` and blocks new runs of the same kind for 90 minutes.
- To try collection without touching production, start `pnpm --filter @repo/db pglite:serve`, run
  `pnpm db:migrate` and then `pnpm worker ingest` with `DATABASE_URL` and `DATABASE_MIGRATION_URL` set to
  `postgresql://postgres:postgres@127.0.0.1:54329/postgres`. Environment variables override `.env`.
- A board failing with `robots.txt disallows` must stay off. `couldn't be read` and `returned 5xx` are usually
  temporary. `returned 404` usually means the company moved ATS: find the new board and update its entry.

## Restore a backup (M7)

To be written with the M7 backup workflow. Until then, the free plan has **no backups**, so avoid destructive manual SQL.

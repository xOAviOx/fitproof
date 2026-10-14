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
  stored requirements, cached embeddings, and cached explanations when nothing changed.
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

## Add a company to the registry (M4)

To be written with the M4 connectors. It will cover adding the company to `data/companies.seed.json`, then running `pnpm worker ingest --company <slug>`.

## Restore a backup (M7)

To be written with the M7 backup workflow. Until then, the free plan has **no backups**, so avoid destructive manual SQL.

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

## Rotate keys

| Secret | Where it lives | How to rotate |
| --- | --- | --- |
| Database password | `DATABASE_URL`, `DATABASE_MIGRATION_URL` (Vercel, GitHub, `.env`) | Supabase → Project Settings → Database → Reset password. Update all three places, then redeploy on Vercel |
| Supabase publishable key | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys → create a new publishable key, update Vercel, redeploy, then revoke the old key |
| Google OAuth client secret | Supabase Auth provider settings | Rotate in Google Cloud Console, then paste the new secret into Supabase |
| Gemini API key | `GEMINI_API_KEY` (worker only) | Create a new key in AI Studio, update the worker environment, then delete the old key |
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

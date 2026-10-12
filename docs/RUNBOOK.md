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

## Rotate keys

| Secret | Where it lives | How to rotate |
| --- | --- | --- |
| Database password | `DATABASE_URL`, `DATABASE_MIGRATION_URL` (Vercel, GitHub, `.env`) | Supabase → Project Settings → Database → Reset password. Update all three places, then redeploy on Vercel |
| Supabase publishable key | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys → create a new publishable key, update Vercel, redeploy, then revoke the old key |
| Google OAuth client secret | Supabase Auth provider settings | Rotate in Google Cloud Console, then paste the new secret into Supabase |
| Gemini API key (M1) | `GEMINI_API_KEY` | Create a new key in AI Studio, update the env, redeploy, then delete the old key |

## Delete a user on request

- **Today:** go to Supabase → Authentication → Users, find the user, and choose **Delete user**. Every user-owned row cascades away, including cached LLM outputs.
- **From M1:** also delete the user's folder in the `resumes` Storage bucket. M7 adds a self-serve deletion flow and a script that does both.
- Record the request date and completion date in your support log, not in the app database.

## Add a company to the registry (M4)

To be written with the M4 connectors. It will cover adding the company to `data/companies.seed.json`, then running `pnpm worker ingest --company <slug>`.

## Restore a backup (M7)

To be written with the M7 backup workflow. Until then, the free plan has **no backups**, so avoid destructive manual SQL.

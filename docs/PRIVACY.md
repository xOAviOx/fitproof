# Privacy and data handling

This describes how the system handles personal data today and what each later milestone adds. Keep it accurate. If code and this document disagree, fix one of them.

## What we store

| Data | Where | Notes |
| --- | --- | --- |
| Email address | Supabase Auth (`auth.users`), mirrored to `public.users` | Used for sign-in only |
| Résumé file (from M1) | Supabase Storage, private bucket | Accessed through short-lived signed URLs; maximum 5 MB |
| Extracted résumé text (from M1) | `resume_files.extracted_text` | Used only to verify that quoted résumé evidence exists |
| Candidate profile (from M1) | `candidate_profiles` and `profile_*` tables | Editable by the user; contact links are stored but never used for matching |
| Preferences and eligibility (from M2) | `preferences` | Includes graduation year, degree, CGPA, and work authorization |
| Matches, feedback, applications | `matches`, `match_feedback`, `saved_jobs`, `applications`, `tailoring_suggestions` | |
| Cached LLM outputs (from M1) | `llm_cache` (tagged with `user_id`) | Purged on account deletion |

## Access control

- Row Level Security is enabled on every table. Users can read and write only their own rows. Job tables are read-only, and pasted jobs are visible only to the person who pasted them. Server-only tables are not reachable through Supabase's API at all.
- The app's own queries run as the signed-in user under RLS (`withUserContext`), not as a superuser. See ADR-005.
- Secrets live only in environment variables. Nothing secret is committed. `.env` files are gitignored.

## LLM processing (from M1)

- **Personal information is stripped before any LLM call.** Name, email, phone, address, and profile URLs are removed from any text sent to an LLM for extraction, matching, or tailoring. Contact details are never matching inputs.
- **No training on user data.** We do not use user data to train models.
- **Provider retention.** Free-tier LLM APIs (including the Gemini free tier) may retain inputs and use them to improve the provider's products. **Before onboarding real users, switch to a paid tier, or to a provider whose terms exclude training on and retention of API inputs.** The provider is one environment variable.

## Account deletion

- **Today (M0):** deleting the user in Supabase (Dashboard → Authentication → Users → Delete) cascades through `public.users` to every user-owned row, including cached LLM outputs, which carry `user_id`.
- **From M1:** stored résumé files must also be removed from Storage. A self-serve "Delete my account" flow that purges files, rows, embeddings, and cached LLM outputs ships in M7 (see `RUNBOOK.md`).

## Logging

- Structured logs (pino) redact email, password, cookie, and authorization fields. Request logs never include résumé text or job descriptions.

## Backups

- The Supabase free plan has no point-in-time recovery. A nightly encrypted `pg_dump` workflow ships in M7. Backups will contain personal data and must be stored encrypted, with access limited to the owner.

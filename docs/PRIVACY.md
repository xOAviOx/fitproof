# Privacy and data handling

This describes how the system handles personal data today and what each later milestone adds. Keep it accurate. If code and this document disagree, fix one of them.

## What we store

| Data | Where | Notes |
| --- | --- | --- |
| Email address | Supabase Auth (`auth.users`), mirrored to `public.users` | Used for sign-in only |
| Résumé file | Supabase Storage, private bucket | Accessed through 60-second signed URLs after an RLS ownership check; maximum 5 MB |
| Extracted résumé text | `resume_files.extracted_text` | Used only to verify that quoted résumé evidence exists |
| Candidate profile | `candidate_profiles` and `profile_*` tables | Editable by the user; contact links are stored but never used for matching |
| Preferences and eligibility (from M2) | `preferences` | Roles, cities, relocation, salary floor, notice period, start date, graduation year, degree, branch, CGPA or percentage, and work authorization. All optional except roles, job types, and cities (unless remote only). Used only by deterministic filters |
| Pasted or linked jobs (from M3) | `jobs` (with `owner_user_id`), `job_requirements` | The description text the user pasted or that was read from their link, plus extracted requirements and quotes. Visible only to the owner; deleted with the account |
| Fetched job pages (from M3) | `job_postings`, source `user_url` | Server-only cache of public posting pages: page text, title, company, and the requested URL. Holds **no user ID**, so it is shared across users and is not removed on account deletion. Reused for 24 hours; physical pruning is part of M7 |
| Collected jobs (from M4) | `companies`, `job_postings` (ATS and Adzuna sources), shared `jobs` (no owner), `job_requirements`, `job_duplicates` | Public postings from company job boards and Adzuna: title, company, locations, pay when published, the description, and the source's API record with its description fields (and SmartRecruiters' recruiter field) removed. No user data. Recruiter emails and phone numbers are masked in the stored description. Raw postings are deleted 60 days after they close |
| Embeddings (from M3) | `job_embeddings`, `profile_embeddings` | Vectors of masked job requirement quotes and masked confirmed experience and project text, keyed by model and content hash. Deleted with the job or account |
| Matches, gap answers, tracker | `matches`, `match_feedback`, `saved_jobs`, `applications`, `tailoring_suggestions` | Band, score breakdown, and verified explanation per job; "I have this" / "I don't have this" answers; tracker status, notes, and next-action date |
| Cached LLM outputs | `llm_cache` (tagged with `user_id`) | Per-user content hashes; expire logically after 30 days and are purged on account deletion |

## Access control

- `/admin` shows aggregate collection counts and model token use only, no per-user data, and is limited to emails listed in `ADMIN_EMAILS`.
- Row Level Security is enabled on every table. Users can read and write only their own rows. Job tables are read-only, and pasted jobs are visible only to the person who pasted them. Server-only tables are not reachable through Supabase's API at all.
- The app's own queries run as the signed-in user under RLS (`withUserContext`), not as a superuser. See ADR-005.
- Secrets live only in environment variables. Nothing secret is committed. `.env` files are gitignored.

## LLM processing

- **Personal information is stripped before any LLM call.** Name, email, phone, address, and profile URLs are removed from any text sent to an LLM for extraction, matching, or tailoring. Contact details are never matching inputs.
- **Conservative résumé redaction.** M1 discards the header before the first recognized section, removes labelled contact/address lines, masks embedded emails, phones, URLs, and postal codes, and removes names discovered in the header if repeated. Unrecognized section layouts are rejected before a provider call. This is a heuristic, not a guarantee for arbitrary prose or unconventional layouts; validate real-world layouts before onboarding users. Manually entered profile content is not sent to a provider in M1.
- **Preferences and eligibility answers are never sent to an LLM.** Filters run as code in `packages/core`. Prefilling education copies the user's own profile rows on the server. The filter preview uses made-up example postings and no external data. From M3, an explanation prompt states, for each eligibility requirement in the posting, whether it is met, not met, or needs a check. That status is derived from the answers; the answers themselves (cities, salary, CGPA, and so on) are not included.
- **Job descriptions (from M3).** Recruiter emails and phone numbers are masked before a posting is sent for requirement extraction or embedding. Without LLM settings, postings are read by keyword on the server and nothing is sent to a provider.
- **Match explanations (from M3).** To explain a match, the provider receives the posting's requirements and quotes, and the user's *confirmed* profile entries: job titles and employers, project names, degree, branch and institution, certifications, bullets, coursework, and skills. Emails, phone numbers, and links are masked first, and unconfirmed entries are never sent. Responsibility similarity sends the same masked experience and project text to the embedding model. Every quote the model returns is checked against the masked text before it is shown.
- **Collected jobs (from M4)** are read by keyword on the server. Nothing is sent to an LLM provider.
- **Job links (from M3).** The fetcher (FitwiseBot, described at `/bot`) requests only the link the user submitted, its robots.txt, and redirect targets. It sends no cookies or user details, and never contacts LinkedIn, Naukri, Indeed, Glassdoor, or foundit.
- **Contact links stay local.** URLs are extracted locally and attached after the provider response. They are not included in the extraction prompt or cache.
- **No training on user data.** We do not use user data to train models.
- **Provider retention.** Free-tier LLM APIs (including the Gemini free tier) may retain inputs and use them to improve the provider's products. **Before onboarding real users, switch to a paid tier, or to a provider whose terms exclude training on and retention of API inputs.** The provider is one environment variable.

## Account deletion

- **Today (M0):** deleting the user in Supabase (Dashboard → Authentication → Users → Delete) cascades through `public.users` to every user-owned row, including cached LLM outputs, which carry `user_id`.
- **Today:** stored résumé files must also be removed from Storage before deleting the auth user. A self-serve "Delete my account" flow that purges files, rows, embeddings, and cached LLM outputs ships in M7 (see `RUNBOOK.md`).

## Logging

- Structured logs (pino) redact email, password, cookie, and authorization fields. Request logs never include résumé text or job descriptions.
- Extraction logs include run IDs, token counts, cache hits, and quote validity only. Raw parser/provider errors, request bodies, and filenames are not logged or copied to job errors.
- Collection logs (from M4) include company slugs, ATS names, posting counts, and error messages that carry only a host and path, never posting text.
- Job logs (from M3) include user, job, and run IDs, the band, token counts, quote-validity rates, and error class or database codes. They never include posting text, job links, profile text, or explanation prose.

## Retention and replacement

Re-uploading replaces the editable draft after successful extraction, not the original file history. Older files and
extracted text remain private until the operator removes them or the account is deleted. Failed upload transactions
attempt Storage cleanup; operators should reconcile orphan files if that cleanup fails. Physical cache/counter
pruning and automated retention/deletion are part of M7.

## Backups

- The Supabase free plan has no point-in-time recovery. A nightly encrypted `pg_dump` workflow ships in M7. Backups will contain personal data and must be stored encrypted, with access limited to the owner.

# Backlog

Ideas that are deliberately **out of scope** for the MVP. Record new ideas here instead of building them.

## Explicit non-goals (from the product spec)

- Email and push alerts for new matches (Resend is the planned provider)
- Side-by-side job comparison
- Multiple search profiles per user (the `preferences` schema already allows this; see the comment in `packages/db/src/schema/preferences.ts`)
- Company watchlists
- Alternative career-path suggestions
- Interview preparation
- Auto-apply
- Scraping job boards whose terms prohibit it (LinkedIn, Naukri, and others)

## Ideas noted during the build

- Product analytics with PostHog (later)
- A CI job that runs migrations and RLS tests against `supabase start` (Docker) to catch drift between Supabase and the PGlite stub
- `@axe-core/playwright` accessibility assertions on every e2e page (planned for the M7 accessibility pass)
- CGPA ↔ percentage conversion per university. Deliberately not done; cross-scale cutoffs show a check (ADR-019)
- Work authorization for countries other than India (today those requirements always show a check)
- Grow the city, degree, and branch vocabularies from real job descriptions collected in M4 (ADR-020)
- Add real job descriptions (with permission) and a second labeller to `data/eval`; today's 12 are synthetic (ADR-028)
- Grow the 67-skill vocabulary from real postings. The keyword baseline missed Celery because it isn't listed
- Treat alternatives such as "Python or R" as one requirement. Today each skill counts separately, so missing
  either one lowers coverage
- A model-free similarity signal (for example, lexical overlap of responsibilities) so keyword mode can reach Strong
- Mask recruiter names in pasted descriptions. Only emails and phone numbers are masked today
- Let users delete a job they added. Today jobs stay until the account is deleted; the tracker entry can be removed
- Retry an explanation after a temporary provider error (429 or 5xx). Today the job shows the structured overlap
  until the user chooses to check again
- Compute embeddings in the eval so Strong is reachable and band agreement means more (separate embedding quota)
- Move from the AI SDK's deprecated `generateObject` to `generateText` with structured output

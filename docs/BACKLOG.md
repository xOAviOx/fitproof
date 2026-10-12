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

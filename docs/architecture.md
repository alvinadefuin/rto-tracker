# Architecture

Personal RTO (return-to-office) day tracker. Single-purpose web app: mark which
weekdays you were in the office, see whether you're meeting the company's monthly
RTO requirement.

## Stack

- **Next.js (App Router, TypeScript)** — UI and API in one codebase, deployed on Vercel
- **Neon Postgres** via **Drizzle ORM** (`@neondatabase/serverless` driver)
- **Auth.js v5** with Google OAuth, Drizzle adapter, database sessions
- **Vitest** for unit tests

## Data model

Auth.js standard tables (`users`, `accounts`, `sessions`, `verification_tokens`) plus:

```
day_entries
  user_id  text  → users.id (cascade delete)
  date     text  'YYYY-MM-DD'
  status   enum  'office' | 'leave' | 'holiday'
  PRIMARY KEY (user_id, date)
```

**Absence of a row on a weekday means WFH.** Weekends are never stored.

## Computation rules

All in `src/lib/rto.ts` as pure functions over `YYYY-MM-DD` strings (no Date
parsing of strings — UTC component math only, to avoid timezone drift).

- Eligible working days in a month = weekdays − mandated WFH − holidays − leaves
- Mandated WFH days come from `wfh_mandates` day ranges, not from `day_entries`, and
  take precedence over any recorded status
- Required office days = `ceil(eligible × targetPercent / 100)`, where `targetPercent`
  comes from `rto_targets` for that month, defaulting to 40
- RTO % = office ÷ eligible (0 when eligible is 0)
- Weekly breakdown: Mon–Fri chunks, partial chunks at month edges — informational
  only. The requirement is computed per month and assessed across the financial year
- Financial years run Aug–Jul, named for the year they end in (FY2027 = Aug 2026 –
  Jul 2027). Compliance is cumulative within a year and resets at the boundary
- FY required office days = `ceil(Σ(eligible_m × percent_m) / 100)` — one rounding step
  for the year, not one per month
- The FY shown is the one containing the *displayed* month; the clock is read only to
  pick the default month when `?m=` is absent, through local getters, so that one
  choice is server-timezone-dependent — and near 31 Jul / 1 Aug it is an FY boundary
- The FY window starts no earlier than the month of the first recorded day

## Data flow

Server component (`page.tsx`) authenticates via `auth()`, queries the month's
entries for the session user, computes stats, renders. The calendar is a client
component: tapping a weekday cycles WFH → Office → Leave → Holiday → WFH,
updates optimistically, and persists via the `setDayStatus` server action
(upsert, or delete when cycling back to WFH). On failure the cell reverts and a
toast is shown.

The page also loads the FY-to-date window — entries and mandates from the FY's first
counted month through the displayed month — and passes the earlier months to the client
as a two-number aggregate, so the calendar can recompute the year's position locally
after each tap.

## Schema delivery

`src/db/schema.ts` is the source of truth; `drizzle/` holds the generated migrations that
carry it to a database. `drizzle-kit generate` writes them, they are committed with the
schema change, and the production Vercel build applies whatever is pending via
`scripts/migrate.mjs` before the deployment is promoted. The dev Neon branch is migrated
locally with `npm run db:migrate`. See `docs/decisions/0004-migrations-on-deploy.md`.

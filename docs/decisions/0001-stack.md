# ADR 0001: Stack and key data choices

Date: 2026-08-13. Status: accepted.

## Context

Personal single-user-per-account app, used from multiple devices (laptop +
phone), so data must live server-side. Owner wants Neon Postgres and Google
sign-in.

## Decisions

1. **Next.js App Router on Vercel** over SPA + separate API: one codebase, one
   deploy, server actions remove the need for a hand-rolled API layer.
2. **Auth.js v5 + Drizzle adapter with database sessions**: auth tables live in
   the same Neon database; no separate auth service.
3. **Dates stored as `text` `YYYY-MM-DD`, not `date`/`timestamp`**: the app
   reasons about calendar days, never instants. String dates end-to-end remove
   the whole class of timezone off-by-one bugs; Postgres `date` would round-trip
   through JS `Date` objects in the driver.
4. **No row = WFH** rather than storing an explicit `wfh` status: keeps the
   table small and makes the default state impossible to get wrong.
5. **40% target rounds up** (`ceil`): 22 eligible days → 9 required, since 8
   days would be 36%, below the requirement.

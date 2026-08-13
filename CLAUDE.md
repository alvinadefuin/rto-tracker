# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm install
npm run dev                # next dev on :3000
npm run build              # next build
make test                  # → npm test → vitest run --passWithNoTests
make lint                  # → npm run lint → eslint
npx drizzle-kit push       # sync src/db/schema.ts to Neon (reads .env.local)
npx auth secret            # generate AUTH_SECRET
```

Single test / single case:

```bash
npx vitest run src/lib/rto.test.ts
npx vitest run -t "returns 22 weekdays for Jan 2026"
```

Env lives in `.env.local` (copy from `.env.example`): `DATABASE_URL`, `AUTH_SECRET`,
`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. `drizzle.config.ts` loads `.env.local` explicitly
via dotenv; Next loads it on its own. There is no migrations directory — schema changes go
out with `drizzle-kit push`.

## Architecture

Single-purpose app: mark which weekdays you were in the office, see whether you meet a 40%
monthly RTO requirement. Next.js App Router + Drizzle + Neon Postgres + Auth.js v5 (Google,
database sessions via the Drizzle adapter). `docs/architecture.md` and
`docs/decisions/0001-stack.md` hold the design rationale.

**Dates are `YYYY-MM-DD` strings end-to-end** — the DB column is `text`, not `date`. The app
reasons about calendar days, never instants. `src/lib/rto.ts` does UTC component math only
(`Date.UTC(...)`, `getUTCDay()`); never parse a date string through the local timezone or a
`new Date("2026-01-05")`. This is the single most important invariant in the codebase — a
`date` column or a local-time parse reintroduces off-by-one bugs across the whole app.

**Absence of a row on a weekday means WFH.** There is no `wfh` status; the enum is
`office | leave | holiday`. Weekends are never stored, and `setDayStatus` rejects them.
Cycling a day back to WFH deletes the row.

Eligible days = weekdays − holidays − leaves. Required = `ceil(0.4 × eligible)` (rounds up
deliberately: 22 eligible → 9, since 8 would be 36%). The per-week Mon–Fri breakdown is
informational — the requirement is monthly.

### Data flow

`src/app/page.tsx` (server component) gates on `auth()`, reads the month from `?m=YYYY-MM`
(`searchParams` is a Promise in this Next version — `await` it), queries `day_entries` for
the session user, and hands a plain `Entries` map to `<Calendar>`.

`src/components/calendar.tsx` (client) owns the interaction: tapping a weekday cycles
`null → office → leave → holiday → null`, updates local state optimistically, and calls the
`setDayStatus` server action. On rejection it reverts that cell and shows a toast — there is
no refetch, so **the client recomputes stats from local state** with the same
`computeMonthStats` the server would use. Keep that function pure and isomorphic.

`src/app/actions.ts` re-validates everything server-side (session, date shape, weekend,
status) — the client is not trusted. It upserts on the `(user_id, date)` primary key, or
deletes for `null`.

Today's date is resolved client-side only, via `useSyncExternalStore` with a `null` server
snapshot, so SSR output stays timezone-independent.

### Conventions

- `@/*` maps to `src/*` (tsconfig and vitest both).
- Tailwind v4: the palette and fonts are CSS variables in the `@theme` block of
  `src/app/globals.css` (`paper`, `ink`, `rule`, `stamp`, `leave`, `holiday`, `fade`).
  There is no `tailwind.config.*` — add design tokens there, not in a config file.
- Vitest runs in a `node` environment; only `src/lib/rto.ts` (pure logic) is unit-tested.

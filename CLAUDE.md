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
npm run db:push            # sync src/db/schema.ts to the DEV Neon branch
npm run db:push:prod       # ...and to the PRODUCTION branch — both, every time
npx auth secret            # generate AUTH_SECRET
```

Single test / single case:

```bash
npx vitest run src/lib/rto.test.ts
npx vitest run -t "returns 22 weekdays for Jan 2026"
```

Env lives in `.env.local` (copy from `.env.example`): `DATABASE_URL`, `PROD_DATABASE_URL`,
`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. `drizzle.config.ts` loads
`.env.local` explicitly via dotenv; Next loads it on its own.

**There is one Neon project with two branches, and a schema change must be pushed to both.**
`DATABASE_URL` points at the dev branch (`br-small-salad-az4cwdel`); Vercel's own
`DATABASE_URL` points at the default `production` branch (`br-flat-night-azuif9ye`).
`PROD_DATABASE_URL` is the second one, used *only* by `npm run db:push:prod` — the app never
reads it. There is no migrations directory, so nothing reconciles the two branches for you
and nothing fails at build time: a table pushed to dev but not prod compiles, deploys, and
then 500s the first authenticated request that touches it. This is exactly how `rto_targets`
took production down after `d93c037`. **Editing `src/db/schema.ts` means running both
`npm run db:push` and `npm run db:push:prod` before the work is done.**

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

Eligible days = weekdays − holidays − leaves. Required = `ceil(eligible × targetPercent / 100)`
(rounds up deliberately: 22 eligible at 40% → 9, since 8 would be 36%). The per-week
Mon–Fri breakdown is informational — the requirement is monthly.

**The target rate is per date range, not a constant.** `rto_targets` holds closed periods
(`start_month`, `end_month`, `percent`) per user; `end_month` NULL means ongoing. Months
covered by no period use `DEFAULT_RTO_PERCENT` (40). Month keys are `YYYY-MM` **text**, so
range checks are pure string comparisons — same reasoning as day keys. Overlapping periods
are rejected in `settings-actions.ts`; gaps are intentional and mean "use the default".
`resolvePercent` lives outside `computeMonthStats` so each is separately testable.

### Data flow

`src/app/page.tsx` (server component) gates on `auth()`, reads the month from `?m=YYYY-MM`
(`searchParams` is a Promise in this Next version — `await` it), queries `day_entries` for
the session user, and hands a plain `Entries` map to `<Calendar>`.

**`<Calendar>` must keep its `key={monthKey}`.** Next does not remount on search-param
changes, and Calendar seeds its state from `initialEntries` only on mount — so without the
key, sliding months keeps the previous month's entries and the new month renders blank.

`src/components/calendar.tsx` (client) owns the interaction: tapping a weekday cycles
`null → office → leave → holiday → null`, updates local state optimistically, and calls the
`setDayStatus` server action. On rejection it reverts that cell and shows a toast. The
displayed month is never refetched mid-edit, so **the client recomputes stats from local
state** with the same `computeMonthStats` the server would use. Keep that function pure and
isomorphic.

`src/app/actions.ts` re-validates everything server-side (session, date shape, weekend,
status) — the client is not trusted. It upserts on the `(user_id, date)` primary key, or
deletes for `null`, then calls `revalidatePath("/")`. That call is required, not cosmetic:
the client cache reuses page payloads on browser back/forward, so without it an edit
disappears from the render when you navigate back to its month. Search params aren't part of
the route, so `"/"` covers every `?m=`.

Today's date is resolved client-side only, via `useSyncExternalStore` with a `null` server
snapshot, so SSR output stays timezone-independent.

### Conventions

- `@/*` maps to `src/*` (tsconfig and vitest both).
- Tailwind v4: the palette and fonts are CSS variables in the `@theme` block of
  `src/app/globals.css` (`paper`, `ink`, `rule`, `stamp`, `leave`, `holiday`, `fade`).
  There is no `tailwind.config.*` — add design tokens there, not in a config file.
- Vitest runs in a `node` environment; only `src/lib/rto.ts` (pure logic) is unit-tested.

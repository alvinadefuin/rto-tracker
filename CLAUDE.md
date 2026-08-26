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
npm run db:generate        # src/db/schema.ts → a new migration in drizzle/; commit it
npm run db:migrate         # apply pending migrations to the DEV branch
npm run db:check           # validate the journal (recreates an empty drizzle/ if absent)
npx auth secret            # generate AUTH_SECRET
```

Single test / single case:

```bash
npx vitest run src/lib/rto.test.ts
npx vitest run -t "returns 22 weekdays for Jan 2026"
```

Env lives in `.env.local` (copy from `.env.example`): `DATABASE_URL`, `AUTH_SECRET`,
`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. `drizzle.config.ts` loads `.env.local` explicitly
via dotenv; Next loads it on its own.

**Schema changes travel as committed migrations, and production applies them on deploy.**
One Neon project, two branches. Locally `DATABASE_URL` is the dev branch
(`br-small-salad-az4cwdel`); on Vercel that same variable name is the default
`production` branch (`br-flat-night-azuif9ye`). No production connection string lives on
your laptop any more, so no command can target production by reading a variable.

That stops accidents, not determined access: both branches share the `neondb_owner` role
and its password, so the dev URL differs from production's only by hostname. A separate
lower-privileged dev role would close that; there isn't one today.

Editing `src/db/schema.ts` means:

1. `npm run db:generate` — writes `drizzle/NNNN_<name>.sql`. **Read it.** `generate`
   cannot tell a rename from a drop-plus-add and will emit destructive SQL for one.
2. `npm run db:migrate` — applies it to the dev branch.
3. Commit `drizzle/` alongside the schema change. The migration file *is* the change; a
   schema edit without its migration ships nothing.

Production migrates itself: `vercel.json` runs `next build && node scripts/migrate.mjs`,
and `scripts/should-migrate.mjs` lets that through only on `VERCEL_ENV=production`. A
failed migration exits non-zero, so that build fails and is never promoted. Read that
narrowly: it means a *failing* migration cannot ship. It does not mean the schema is always
correct — the first rule below is a way to deploy green against a schema that never
changed. This replaces a two-push routine that took production down twice — with
`rto_targets` after `d93c037`, and with `wfh_mandates` after `431cff2`.

Four rules the mechanism creates:

- **Never edit `schema.ts` without generating.** This is the one remaining way to
  reproduce the old outage, and it now takes forgetting *one* command instead of two.
  `next build` type-checks against `schema.ts`, not against the database, so a schema edit
  with no migration compiles, deploys green, reports matching migration counts, and then
  500s on the first query touching the new column. The code ships; only the schema doesn't.
  If you touched `schema.ts`, `drizzle/` belongs in the same commit.
- **Regenerate after rebasing onto main.** A migration's position is its `when` timestamp
  in `drizzle/meta/_journal.json`, not its filename. The migrator reads only the newest
  applied row and applies whatever is newer, so a migration older than that row would
  otherwise be skipped with no error. `migrate` now catches this — it compares the
  journal's entry count against the rows recorded in the database and fails the build on a
  shortfall — but the fix is still to delete yours and regenerate it after a rebase.
- **Expand, then contract, across two deploys.** Migrations apply during the build while
  the previous deployment is still serving, and Vercel's rollback reverts code but never
  schema. Add and backfill in one deploy; drop only once the new code is live.
- **Never `drizzle-kit push`.** It mutates a branch without journalling, so the next
  `migrate` tries to create what is already there and fails. If dev drifts, reset it from
  its parent in the Neon console and migrate forward.

**A failed migration can leave the schema half-changed, and there is no automatic
recovery.** `neon-http` runs each statement as its own round-trip with no enclosing
transaction, and writes journal rows only after every migration has applied — so a failure
part-way leaves earlier statements applied and unrecorded, and every later build then fails
on already-existing objects. Repair it by hand: either reconcile the objects in the Neon
console, or run the emergency path against production —
`DATABASE_URL=<prod-url> node scripts/migrate.mjs`, pasting the URL for that one
invocation and never storing it in `.env.local`. Keeping each migration small and additive
is what limits how much there is to repair.

`docs/decisions/0004-migrations-on-deploy.md` records the remaining operational hazards,
including that a failed migration echoes its SQL into a durable build log.

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

Eligible days = weekdays − mandated − holidays − leaves. Required =
`ceil(eligible × targetPercent / 100)`
(rounds up deliberately: 22 eligible at 40% → 9, since 8 would be 36%). The per-week
Mon–Fri breakdown is informational — the requirement is computed per month and assessed
across the financial year.

**The target rate is per date range, not a constant.** `rto_targets` holds closed periods
(`start_month`, `end_month`, `percent`) per user; `end_month` NULL means ongoing. Months
covered by no period use `DEFAULT_RTO_PERCENT` (40). Month keys are `YYYY-MM` **text**, so
range checks are pure string comparisons — same reasoning as day keys. Overlapping periods
are rejected in `settings-actions.ts`; gaps are intentional and mean "use the default".
`resolvePercent` lives outside `computeMonthStats` so each is separately testable.
The settings form posts whole `YYYY-MM-DD` dates from a date picker and `toMonthKey`
truncates them; `rto_targets` still stores `YYYY-MM`, and nothing downstream of the
action ever sees a day.

**Mandated WFH days are excluded outright.** `wfh_mandates` holds inclusive day ranges
(`start_date`, `end_date`) per user; `end_date` NULL means until further notice. Dates are
`YYYY-MM-DD` **text**, so range checks are pure string comparisons — the same reasoning as
month keys. Overlaps are rejected in `mandate-actions.ts`. A mandate wins over anything in
`day_entries`: `isEligible` checks it first, so an `office` stamp inside a mandate is still
rendered (faded, as a record) but excluded from `officeDays` — which is what keeps
`officeDays ≤ eligibleDays` and `achievedPercent ≤ 100`. `MonthStats.mandatedDays` exists
because `eligibleDays === 0` now has two causes and the copy differs between them.

**Imported public holidays are ordinary `day_entries` rows.** `importHolidays` in
`src/app/holiday-actions.ts` reads Google's public Philippine holiday ICS feed and writes
`status: "holiday"` rows for one financial year at a time, with the holiday's name in the
new nullable `note` column — display copy only, never parsed, exactly like
`wfh_mandates.reason`. Nothing about the arithmetic changes: `isEligible` already excludes
`holiday`, so the requirement falls out for free. The country is hardcoded for the same
reason `FY_START_MONTH` is.

Being rows rather than a third overlay is the design, not laziness. **A tap must beat the
feed** — a proclamation can be revoked, or the office opens anyway — and an overlay would
inherit the mandate rule, where the exclusion beats anything the user tapped. As rows, a
tap simply rewrites them. The import never overwrites an existing row, which is what makes
a re-run safe.

**The import never writes a day earlier than `min(day_entries.date)`.** This is the
feature's one load-bearing invariant, enforced and tested in `planHolidayImport`
(`src/lib/holidays.ts`), never in the action. Imported holidays *are* `day_entries` rows,
so `fyWindowStart` derives an FY window's start from them — an unclamped import would
silently redefine which months a year bills. For a record beginning 11 Feb 2026,
importing FY2026 without the clamp would write Ninoy Aquino Day 2025, move the window
start back to Aug 2025, and report a five-month deficit against months of unemployment.

`parseHolidayIcs` keeps only events whose ICS `DESCRIPTION` begins `Public holiday`. That
is an allowlist on purpose: the live feed carries exactly two values, `Public holiday` and
`Observance`, and were the field renamed, an allowlist marks nothing and the action says
so, where a denylist would mark Easter Sunday a holiday and quietly lower the requirement.
An empty parse from a feed that answered is therefore reported as a format change, not as
a year without holidays.
A second allowlist, `NATIONWIDE_HOLIDAYS`, decides which of those are non-working
*nationwide*: the feed carries no such field — every event is `CLASS:PUBLIC` and
`DESCRIPTION` takes only two values — so the judgement lives in code. It drops the BARMM-only
days (Maulid un-Nabi, Lailatul Isra Wal Mi Raj, Amun Jadid) and the second Eid day
(`Eid al-Adha Holiday`), which is a second day rather than a weekend substitute — unlike
`Day off for X`, which is kept. Both allowlists fail the same way on purpose: an unknown name
is dropped, leaving the day eligible and the requirement *higher*, where a denylist would mark
it and quietly lower the requirement.

**`ph_holidays` is the calendar; `day_entries` is the record.** The import writes both: every
nationwide holiday of the year — **weekends included, and not clamped** — to the global
`ph_holidays` table, and only the eligible weekdays to `day_entries`. Nothing computed reads
`ph_holidays`; it feeds the month footnote alone, which is what keeps a tap beating the feed.
It is unclamped safely because `fyWindowStart` derives its window from `day_entries` only.
The import replaces the year's reference rows rather than upserting them, so a shifted
tentative date does not accumulate a stale row beside the new one.

The footnote lists every holiday the month has, annotating an entry only where the day is
**still eligible** — `isEligible` already excludes mandated days and `leave` as well as
`holiday`, so annotating a leave day would imply it counts when it does not.

`day_entries.note` is still written and now has no reader. It records which rows the import
wrote — provenance a hand-tap cannot carry — and dropping it would need a destructive
migration under the expand-then-contract rule for no gain.

**Compliance is cumulative within a financial year, which runs Aug–Jul.** An FY is
named for the calendar year it ends in: FY2027 is Aug 2026 – Jul 2027
(`FY_START_MONTH = 8`). Within a year a surplus settles a shortfall — miss a day in
February, work an extra in March, and the year is level — and nothing crosses the July
boundary. `aggregateMonths` owns the per-month loop: it sums `eligibleDays × percent`
into `weightedEligible`, in **percent-points and deliberately un-rounded**.
`computeFyStats` adds only the displayed month's own contribution to that already-summed
baseline, then divides by 100 and rounds up exactly once for the year. Rounding per
month instead costs about six office days a year, so never sum per-month
`requiredDays`.

**The FY on screen follows the displayed month; the clock is read once, to choose the
default month.** `financialYearOf` takes a month key for the same reason today's date is
resolved client-side only: a window keyed off `new Date()` would make server output
timezone-dependent. It also means browsing last July shows that year's verdict. But with
no usable `?m=` there is no month to follow, and `currentMonthKey()` in `page.tsx` reads
`new Date()` through **local** getters — so the default month, and with it the default
FY, is server-timezone-dependent, and near 31 Jul / 1 Aug that month boundary is also an
FY boundary.

The FY window starts at the later of the FY's first month and the month of the user's
earliest `day_entries` row, so an FY that predates the app reports nothing rather than a
hundred-day deficit. That rule is `fyWindowStart`, not a ternary in the page.
`page.tsx` hands `<Calendar>` an `FyBaseline` holding **two numbers** for the prior
months, not their entries — only the displayed month is editable from that view, so the
client adds its live month to a fixed prior and re-runs the same single `ceil`.
`FyBaseline` carries nothing derivable: `computeFyStats` takes the displayed month key
and works out the year and its bounds itself, so no caller can pair a July with another
year's bounds.

### Data flow

`src/app/page.tsx` (server component) gates on `auth()` and reads the month from `?m=` —
either a `YYYY-MM` key or a whole `YYYY-MM-DD` day, which `toMonthKey` truncates to its
month (`searchParams` is a Promise in this Next version — `await` it). It then queries
`day_entries` and `wfh_mandates` across the whole FY window rather than the displayed
month alone — the window is one month wide only in August, or when nothing was recorded
before the displayed month — and hands `<Calendar>` a plain `Entries` map of just that
month's rows, the month's `ph_holidays` rows, and the `FyBaseline` for the months
before it.

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

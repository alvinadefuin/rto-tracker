# Per-month RTO target — design

Date: 2026-08-13
Branch: `feat/per-month-rto-target`
Status: approved

## Problem

The monthly RTO requirement is a hardcoded `RTO_TARGET = 0.4` in `src/lib/rto.ts`.
The real policy is not constant: it was reduced to 20% for a period following a fuel
price increase, and may change again. Two consequences:

1. Months from the reduced era are scored against the wrong requirement, so the
   historical record is wrong.
2. Any future change means editing code and redeploying.

The percentage is also hardcoded in user-visible copy in two places, so even a correct
computation would be described incorrectly on screen.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where config lives | Database, editable in the app | No redeploy to change the rate |
| How a change is recorded | Closed period with a start and an end | The real case is a *temporary exception* to a stable baseline; one row expresses it. Effective-from would need three rows (40 → 20 → 40) and encode the baseline twice |
| Overlapping periods | Rejected at write time | At most one period covers any month, so resolution needs no precedence rule |
| Gaps between periods | Allowed, by design | A month in no period uses the default. This is the baseline, not an error |
| Open-ended periods | `end_month` nullable = ongoing | A reduction starting now with no announced end must not require monthly edits |
| Configurable default | No — stays a code constant | An open-ended period already expresses "the baseline changed permanently" |
| Management UI | Separate `/settings` route | Managing a list is page-shaped; keeps the calendar uncluttered |
| Scope | Per user (`user_id`) | Matches `day_entries`; app still behaves if someone on a different policy signs in |

## Data model

New table in `src/db/schema.ts`:

```ts
export const rtoTargets = pgTable(
  "rto_targets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startMonth: text("start_month").notNull(), // YYYY-MM, inclusive
    endMonth: text("end_month"),               // YYYY-MM inclusive, or NULL = ongoing
    percent: integer("percent").notNull(),     // whole percent, 0..100
  },
  (t) => [index("rto_targets_user_start_idx").on(t.userId, t.startMonth)]
);
```

Rationale for each column choice:

- **`YYYY-MM` text, not `date` or `integer`.** Zero-padded fixed-width strings compare
  correctly with `<=` / `>=`, so every range check is a pure string comparison and no
  `Date` object is ever constructed. This extends the codebase's existing
  dates-are-text invariant; a `date` column would reintroduce timezone drift.
- **Whole integer percent, not a float fraction.** `requiredDays` is computed as
  `ceil(eligibleDays * percent / 100)`, which reproduces current numbers exactly
  (`ceil(22*40/100) = 9`, `ceil(20*40/100) = 8`), so existing tests pass unchanged.
  Floats invite precision drift and the UI speaks in whole percents anyway.
- **Surrogate `id`, not a composite key.** Rows are edited and deleted as units, and
  `startMonth` is itself editable, so it cannot be part of the key.
- **`onDelete: "cascade"`** matches `day_entries`: deleting a user removes their config.

Both month bounds are **inclusive**. A period of `2022-06` → `2023-12` covers June 2022
and December 2023 and every month between.

Range is **0–100**, widened from the 1–100 stated during design review. `0` is permitted
so a suspended requirement (a lockdown-style period with no office obligation) is
expressible; it yields `requiredDays = 0` and reads as "target met". This is a strict
widening and breaks nothing. Flag it if unwanted.

## Pure logic — `src/lib/rto.ts`

```ts
export const DEFAULT_RTO_PERCENT = 40;

/** Sentinel for an ongoing period; keeps comparisons pure string compares. */
const OPEN_ENDED = "9999-12";

export interface TargetPeriod {
  startMonth: string;      // YYYY-MM inclusive
  endMonth: string | null; // YYYY-MM inclusive, or null = ongoing
  percent: number;         // whole percent, 0..100
}

/** Whole percent in effect for `monthKey` (YYYY-MM). */
export function resolvePercent(monthKey: string, periods: TargetPeriod[]): number;

/** True when two periods share at least one month. */
export function periodsOverlap(a: TargetPeriod, b: TargetPeriod): boolean;
```

`periodsOverlap` is:

```
a.startMonth <= (b.endMonth ?? OPEN_ENDED) && b.startMonth <= (a.endMonth ?? OPEN_ENDED)
```

`resolvePercent` sorts candidates by `startMonth` ascending and returns the `percent` of
the first period covering `monthKey`, else `DEFAULT_RTO_PERCENT`. Overlaps are prevented
at write time so at most one can match; the sort exists only to make the result
deterministic if a bad row ever reaches the database.

### `computeMonthStats` change

Signature gains a fourth parameter:

```ts
export function computeMonthStats(
  year: number,
  month: number,
  entries: Entries,
  targetPercent: number = DEFAULT_RTO_PERCENT
): MonthStats;
```

Resolution stays **outside** this function. "Which rate applies to this month" and
"compute stats at a given rate" are separate concerns and separately testable. The
function stays pure and isomorphic, as CLAUDE.md requires.

`requiredDays = Math.ceil((eligibleDays * targetPercent) / 100)`. Both operands are
integers and the product is small, so the division is exact for all realistic inputs.

### `MonthStats` changes

Two fields change, resolving a unit inconsistency (approved during design):

```ts
export interface MonthStats {
  eligibleDays: number;
  officeDays: number;
  requiredDays: number;
  remainingNeeded: number;
  targetPercent: number;   // NEW: whole percent required, e.g. 20
  achievedPercent: number; // RENAMED from `percent`; now whole percent, was a 0..1 fraction
  weeks: WeekStats[];
}
```

`achievedPercent = eligibleDays === 0 ? 0 : Math.round((officeDays / eligibleDays) * 100)`.

The rounding moves out of `stats.tsx` into the lib, so both percent fields are the same
unit. Displayed values are unchanged. `stats.tsx` renders `achievedPercent` directly
instead of `Math.round(percent * 100)`.

## Data flow

`src/app/page.tsx` (server component) additionally:

1. Queries `rto_targets` for the session user. The table holds a handful of rows per
   user, so it fetches all of them rather than filtering by month in SQL.
2. `const targetPercent = resolvePercent(monthKey, periods)`.
3. Passes `targetPercent` to `<Calendar>`.

`src/components/calendar.tsx` accepts `targetPercent` and forwards it to
`computeMonthStats(year, month, entries, targetPercent)`. It is a plain prop read during
render, so it tracks month navigation correctly regardless of the `key={monthKey}`
remount.

No change to how `day_entries` are read or written.

## Settings page

`src/app/settings/page.tsx` — server component, gated on `auth()` and redirecting to
`/signin` exactly as `/` does.

Contents:

- The default rate, shown read-only (`Default … 40%`).
- The user's periods, sorted by `startMonth` descending, each row showing the range, the
  percent, and edit / delete controls. An ongoing period renders its end as "ongoing".
- An add form: start month, end month (blank = ongoing), percent.
- A link back to the calendar.

Interaction details, so these are not left to interpretation:

- **Month fields use `<input type="month">`**, whose native value format is exactly
  `YYYY-MM`. No parsing or reformatting on either side. The server still validates the
  shape — the client is not trusted, and the field can be bypassed.
- **Edit is inline.** Activating Edit on a row replaces that row with a form over the
  same three fields plus Save and Cancel. At most one row is editable at a time.
- **Delete acts immediately, with no confirmation step.** A period is three fields and
  trivially re-entered, so a confirmation dialog costs more than the mistake does.

`src/app/page.tsx` header gains a `Settings` link beside `Sign out`, styled to match.

### Server actions

In a new `src/app/settings-actions.ts` (keeping `actions.ts` focused on day entries):

```ts
addTargetPeriod(input):    Promise<{ error?: string }>
updateTargetPeriod(input): Promise<{ error?: string }>
deleteTargetPeriod(id):    Promise<{ error?: string }>
```

Every action re-validates server-side — the client is not trusted, matching
`setDayStatus`:

1. Session exists, else throw.
2. `startMonth` matches `/^\d{4}-(0[1-9]|1[0-2])$/`.
3. `endMonth` is `null` or matches the same pattern.
4. `percent` is an integer, `0 <= percent <= 100`.
5. If `endMonth !== null`, then `endMonth >= startMonth`.
6. No overlap with the user's other periods, via `periodsOverlap`. On update, the row
   being edited is excluded by `id`.
7. On update and delete, the target row must belong to the session user — scope the
   `where` by `userId` so one user cannot address another's row by guessing an id.

Each action calls `revalidatePath("/settings")` and `revalidatePath("/")` on success.
Both are required: the settings list must reflect the change, and the calendar's
required-day count depends on it.

### Error handling

Actions return `{ error: string }` rather than throwing for **validation** failures, so
the page can render the message inline via `useActionState`. Authentication failures
throw, as in `setDayStatus`.

The overlap message names the conflicting period, e.g.
`"Overlaps an existing period (Jun 2022 – Dec 2023, 20%)."` A bare "invalid input" would
leave the user guessing which row collided.

## Testing

Added to `src/lib/rto.test.ts`. Pure functions in the existing node environment — **no
new dependencies, no DOM**, consistent with the documented convention.

`resolvePercent`:
- month inside a closed period → that percent
- month before the earliest period → default
- month after a closed period → default
- both boundary months (`startMonth` and `endMonth`) → that percent, proving inclusivity
- month inside an ongoing (`endMonth: null`) period → that percent
- month before an ongoing period's start → default
- empty period list → default

`periodsOverlap`:
- identical periods → true
- sharing exactly one month at the boundary → true
- adjacent but not touching (`…2023-12` and `2024-01…`) → false
- one open-ended, starting before the other ends → true
- one open-ended, starting after the other ends → false
- both open-ended → true

`computeMonthStats`:
- 22 eligible days at 20% → `requiredDays === 5` (`ceil(4.4)`)
- 22 eligible days at 0% → `requiredDays === 0`, `remainingNeeded === 0`
- the two existing 40% assertions, unchanged, proving no regression
- `achievedPercent` is a whole number and `0` when `eligibleDays === 0`

Validation logic reachable without a database — the overlap rule — lives in `rto.ts` and
is covered above. The server actions themselves stay thin wrappers around it.

## Documentation and copy

Code copy that currently states 40% unconditionally:

- `src/components/stats.tsx:39` — "40% of N eligible working days" → uses
  `targetPercent`. When `targetPercent !== DEFAULT_RTO_PERCENT` the line appends
  `(adjusted from 40%)`, so a 20% month does not read as a bug. That wording is
  deliberately direction-neutral: it covers a rate above the default as well as below,
  which "reduced" would not.
- `src/app/signin/page.tsx:18` — "Stay on the right side of 40%". This page is
  unauthenticated and cannot know the user's rate, so it becomes generic: "Stay on the
  right side of your target."

Docs to update:

- `CLAUDE.md` — the `Required = ceil(0.4 × eligible)` line becomes rate-dependent;
  document the new table, that months are `YYYY-MM` text, and that overlaps are rejected
  while gaps are intentional.
- `README.md` — mention the settings page.
- `docs/architecture.md` — the 40% references.
- `docs/decisions/0002-per-month-targets.md` — new ADR recording the closed-period
  choice over effective-from, matching the existing ADR convention.

## Rollout

No migration needed: the table is new and starts empty, so every month resolves to the
40% default and behaviour is identical to today until a period is added. Schema goes out
with `npx drizzle-kit push`, per the project's no-migrations-directory convention.

The historical 20% period is then entered through the settings UI. Nothing is
backfilled — a period is a statement about a date range, so adding it retroactively
corrects every affected month at once.

## Out of scope

- Configurable default rate. An open-ended period covers a permanent baseline change.
- Per-week or per-quarter requirements. The requirement is monthly.
- Sharing or importing policy config between users.
- Audit history of who changed a period and when.

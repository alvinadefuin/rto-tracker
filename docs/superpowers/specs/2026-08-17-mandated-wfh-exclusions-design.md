# Mandated WFH exclusions — design

Date: 2026-08-17
Branch: `feat/mandated-wfh-exclusions`
Status: in review

## Problem

Following an incident, management has directed everyone to work from home from a
given date **until further notice**. Those days carry no office obligation, so they
must not count toward the monthly RTO requirement. Nothing in the app can express
this today.

The only existing way to take a day out of the eligible pool is to tap it as `leave`
or `holiday`. That fails on three counts:

1. **Wrong reason recorded.** A mandated WFH day is neither leave nor a public
   holiday. Overloading those statuses corrupts the attendance record it exists to keep.
2. **No open end.** "Until further notice" has no end date, so there is no finite set
   of days to tap. Every new month would need re-tapping, indefinitely.
3. **Cost per month.** A fully mandated month is 20-plus taps, repeated forever.

`rto_targets` cannot cover it either. Its granularity is `YYYY-MM`, so a 0% period
starting in August applies to August 1st — it cannot express "from 12 August". It
would also report a misleading `achievedPercent`: 21 eligible days with 3 stamped
reads as 14% achieved when in truth no percentage was owed.

Worked example used throughout this spec: **August 2026** has 21 weekdays. A mandate
running from 12 Aug with no end date covers 14 of them, leaving 7 eligible.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Effect on the maths | Mandated days leave the eligible pool | Same mechanism as a holiday. A partial month then prorates for free: a mandate from 12 Aug 2026 leaves 7 eligible weekdays, so `ceil(7 × 40%) = 3` required instead of 9 |
| Granularity | Day (`YYYY-MM-DD`) | The mandate began mid-month. Month granularity cannot express it |
| Storage | New `wfh_mandates` table | *Which days count* and *what percent applies* are orthogonal facts. A mandate inside a 20% period is legitimate, so they must not share an overlap check |
| Open end | `end_date` nullable = until further notice | Directly models "until further notice"; mirrors `rto_targets.end_month` |
| Office stamp on a mandated day | Mandate wins; stamp kept as a record | Keeps `officeDays ≤ eligibleDays`, so `achievedPercent` cannot exceed 100. The exclusion stays a property of the mandate, not of the user's taps |
| Precedence vs leave/holiday | Mandate checked first | A day that is both is excluded once, not double-counted, and reports as mandated |
| Multiple mandates | A list, overlaps rejected | Incidents recur, and a past mandate must stay on record or its months silently rescore |
| Grid treatment | Hatch on every mandated weekday; label once per run per row | A mandate is a condition imposed on the day, not a fourth status the user chose. A per-cell badge would imply otherwise and repeat 20-plus times |
| Reason note | Optional `reason` column | An open-ended mandate gets edited months later; without a note, which incident it was is lost |
| Scope | Per user (`user_id`) | Matches `day_entries` and `rto_targets` |

## Data model

New table in `src/db/schema.ts`:

```ts
export const wfhMandates = pgTable(
  "wfh_mandates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(), // YYYY-MM-DD, inclusive
    endDate: text("end_date"),               // YYYY-MM-DD inclusive, or NULL = until further notice
    reason: text("reason"),                  // optional note, e.g. "flood incident"
  },
  (t) => [index("wfh_mandates_user_start_idx").on(t.userId, t.startDate)]
);
```

Column rationale, where it differs from `rto_targets`:

- **`YYYY-MM-DD` text, not `date`.** Extends the codebase's central invariant. Fixed-width
  zero-padded strings compare correctly with `<=` / `>=`, so every range check is a pure
  string comparison and no `Date` is constructed for it. A `date` column reintroduces the
  timezone drift the whole app is built to avoid.
- **Surrogate `id`.** Rows are edited as units and `startDate` is itself editable, so it
  cannot be part of the key.
- **`reason` nullable text, unvalidated beyond a length cap.** It is a human note, never
  parsed. Capped at 200 characters server-side.

Both bounds are **inclusive**: `2026-08-12` → `2026-08-20` covers both endpoints and
every day between.

Weekend dates are accepted as bounds without complaint. Exclusion only ever affects
weekdays, so a mandate starting on a Saturday is harmless and rejecting it would be
noise.

## Pure logic — `src/lib/rto.ts`

```ts
export interface WfhMandate {
  startDate: string;       // YYYY-MM-DD inclusive
  endDate: string | null;  // YYYY-MM-DD inclusive, or null = until further notice
  reason?: string | null;  // display only; every helper below ignores it
}

/**
 * Stand-in for "no end date". Same fixed width as a real YYYY-MM-DD key, so
 * comparisons stay pure string compares and no Date is ever constructed.
 * Sibling of the existing OPEN_ENDED month constant.
 */
const OPEN_ENDED_DATE = "9999-12-31";

/** True when `date` falls inside any mandate. */
export function isMandated(date: string, mandates: WfhMandate[]): boolean;

/** True when two mandates share at least one day. */
export function mandatesOverlap(a: WfhMandate, b: WfhMandate): boolean;

/** Weekdays a closed mandate covers. `null` when open-ended. */
export function countWeekdaysInMandate(m: WfhMandate): number | null;

/** True when a **weekday** counts toward the requirement. Callers filter weekends. */
export function isEligible(
  date: string,
  entries: Entries,
  mandates: WfhMandate[]
): boolean;

/** "2026-08-12" → "12 Aug 2026". */
export function formatDate(date: string): string;

/** "12 Aug 2026 – 20 Aug 2026", or "12 Aug 2026 – until further notice". */
export function formatMandateRange(m: WfhMandate): string;
```

`isMandated` is `date >= m.startDate && date <= (m.endDate ?? OPEN_ENDED_DATE)` over
`.some()`. `mandatesOverlap` is the same shape as the existing `periodsOverlap`, one
granularity down:

```
a.startDate <= (b.endDate ?? OPEN_ENDED_DATE) && b.startDate <= (a.endDate ?? OPEN_ENDED_DATE)
```

`isEligible` encodes the precedence rule in one place:

```ts
if (isMandated(date, mandates)) return false;
const status = entries[date];
return status !== "leave" && status !== "holiday";
```

`countWeekdaysInMandate` returns `null` for an open-ended mandate rather than a number,
forcing the caller to handle the unbounded case instead of quietly rendering a wrong
count — the same contract as `countMonthsInPeriod`. For a closed mandate it walks the
range day by day via UTC increments and counts non-weekends. A closed-form weekday
formula would be shorter and harder to trust; the longest realistic span is a few
thousand iterations, evaluated once per delete-dialog render, so clarity wins. The
day-walk lives in an internal `eachDate(start, end)` generator that increments through
`Date.UTC(...)` components only.

`formatDate` and `formatMandateRange` reuse the existing `MONTH_ABBR` table and split on
`-`, constructing no `Date`.

`reason` is **optional** on the type so the range helpers and their test fixtures need
not carry it, while the settings row and the banner — which do display it — can pass a
full row unchanged.

### `computeMonthStats` change

Signature gains a fifth optional parameter:

```ts
export function computeMonthStats(
  year: number,
  month: number,
  entries: Entries,
  targetPercent: number = DEFAULT_RTO_PERCENT,
  mandates: WfhMandate[] = []
): MonthStats;
```

Defaulted, so every existing call and test compiles unchanged. The function stays pure
and isomorphic, as CLAUDE.md requires — the client recomputes stats from local state
with the same function, and mandates are plain data it already holds.

Inside the weekday loop, the mandate check comes **first**:

```ts
if (isMandated(date, mandates)) {
  mandatedDays++;
  continue;               // before the leave/holiday check, so a mandated
}                         // leave day is counted once, as mandated
```

`officeDays` therefore excludes an `office` stamp inside a mandate, which is what keeps
`officeDays ≤ eligibleDays` true and `achievedPercent ≤ 100`.

### `MonthStats` change

One new field:

```ts
export interface MonthStats {
  // …unchanged…
  mandatedDays: number; // mandated weekdays in the month
}
```

It exists to distinguish two different zero states that would otherwise be
indistinguishable: `eligibleDays === 0` because everything was leave, versus because
everything was mandated. The stats copy differs between them, so the reason has to
reach the component. `eligibleDays === 0 && mandatedDays > 0` is the mandated case.

`WeekStats` gains nothing — mandated days simply drop out of its `eligibleDays`, so a
fully mandated week reads `0/0`.

### Reuse cleanup

`calendar.tsx:150-155` recomputes the per-week eligible/office badge with its own copy
of the eligible predicate, duplicating the rule inside `computeMonthStats`. Adding the
mandate condition would duplicate it a second time. Both call sites move to the new
`isEligible`, removing the existing duplication rather than doubling it.

## Data flow

`src/app/page.tsx` gains a second query for mandates intersecting the displayed month:

```ts
where(and(
  eq(wfhMandates.userId, session.user.id),
  lte(wfhMandates.startDate, `${monthKey}-31`),
  or(isNull(wfhMandates.endDate), gte(wfhMandates.endDate, `${monthKey}-01`)),
))
```

The `-31` upper bound is the same trick the existing `day_entries` query uses: it is a
string comparison against a fixed-width key, so a bound past the end of a short month
is harmless.

Results pass to `<Calendar>` as a **plain prop, never seeded into `useState`**. Only
`entries` is optimistic; mandates change only from `/settings`, which revalidates `/`.
The `key={monthKey}` remount rule is unaffected.

The banner renders in `page.tsx` (server), one line per intersecting mandate, from the
mandate's own range. It never consults today's date, so SSR output stays
timezone-independent — the constraint that already forces `today` through
`useSyncExternalStore` in the client.

## Server actions

New `src/app/mandate-actions.ts`, keeping `settings-actions.ts` focused on targets and
`actions.ts` on day entries:

```ts
addWfhMandate(prev, formData):    Promise<ActionState>
updateWfhMandate(prev, formData): Promise<ActionState>
deleteWfhMandate(prev, formData): Promise<ActionState>
```

Server-side re-validation, in order — the client is not trusted:

1. Session exists, else throw.
2. `startDate` matches `/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/`.
3. `startDate` is a **real calendar day**. The regex admits `2026-02-30`, so after the
   shape check, build `Date.UTC(y, m - 1, d)` and confirm `getUTCFullYear` /
   `getUTCMonth` / `getUTCDate` come back unchanged. Still UTC-only component math; no
   local parse.
4. `endDate` is `null` (blank input) or passes both checks above.
5. If `endDate !== null`, then `endDate >= startDate`.
6. `reason` is trimmed; blank becomes `null`; longer than 200 characters is rejected.
7. No overlap with the user's other mandates, via `mandatesOverlap`. On update, the row
   being edited is excluded by `id`.
8. On update and delete, the `where` is scoped by `userId` as well as `id`, so one user
   cannot address another's row by guessing an id.

Validation failures return `{ error }` for inline rendering through `useActionState`;
authentication failures throw. The overlap message names the conflict, e.g.
`"Overlaps an existing mandate (12 Aug 2026 – until further notice)."`

Each action calls `revalidatePath("/settings")` and `revalidatePath("/")` on success.
Both are required: the settings list must reflect the change, and every month the
mandate touches is rescored.

Two extractions so the new code does not import out of the targets feature:

- `src/lib/action-state.ts` — the `ActionState` type alone. Client-safe by construction:
  it exports no runtime value. `period-form.tsx` and `delete-period-button.tsx` switch
  their import here from `settings-actions.ts`; `settings-actions.ts` re-exports the type
  so nothing else breaks.
- `src/lib/require-user.ts` — `requireUserId()`. Deliberately a separate module from the
  type, so importing `ActionState` into a client component cannot pull `auth` into the
  client bundle.

## Calendar UI

A mandated weekday renders as **background texture, not a badge**:

- `.mandate-hatch` in `globals.css`, beside the existing `.stamp-ring` / `.stamp-in`: a
  `repeating-linear-gradient` at 45° drawn from `var(--color-rule)`. No new `@theme`
  token — the palette already carries the right colour.
- Weekends already use flat `bg-ink/4`. Hatch versus flat keeps the two readable as
  different kinds of "does not count".
- The day number stays in `text-fade`.
- The word `mandated` appears **only on the first mandated weekday of each week row**,
  lowercase mono in `text-fade`. Lowercase is deliberate: `OFFICE` / `LEAVE` / `HOLIDAY`
  are uppercase, and the mandate must not read as a fourth member of that set. One label
  per row keeps each row self-explanatory when scanning without repeating itself 20-plus
  times down a fully mandated month. At most one label per row, even in the rare row
  touched by two separate mandates — the label announces the condition, not the row's
  boundaries.
- An `office` stamp inside the window still renders, faded with a strike-through, so the
  attendance record survives while reading plainly as not counted.

Cells stay tappable inside a mandate — the status cycle still writes, so a day can be
recorded accurately for its own sake, and the mandate simply overrides it in the maths.

The `aria-label` reports both facts:
`"2026-08-12: Mandated work from home, Office recorded but not counted. Tap to change."`
and without a status, `"2026-08-12: Mandated work from home. Tap to change."`

The hint line below the grid gains: "Hatched days are mandated work from home — they
don't count toward the requirement."

### Stats copy

- Fully mandated month (`eligibleDays === 0 && mandatedDays > 0`): the ring meter is
  replaced by `No requirement — mandated WFH`. Rendering zero rings and
  `0/0 stamped · target met · 0%` would read as a bug.
- Partial month: the existing line gains a clause —
  `3 office days required — 40% of 7 eligible working days this month · 14 days mandated WFH`.
- `mandatedDays === 0`: copy is byte-for-byte what it is today.

### Banner

Above the calendar, per intersecting mandate:

> Mandated WFH from 12 Aug 2026 — until further notice

and for a closed one:

> Mandated WFH 12 Aug 2026 – 30 Sep 2026

with the reason appended when set: `… — until further notice (flood incident)`.

"From", not "since": a mandate may be entered with a future start date, and "since"
would be false there. Tense-neutral wording is also the only wording that needs no
knowledge of today, which the server render must not have.

## Settings UI

A third section on `/settings`, below the target periods, headed **Mandated WFH**, with
its own intro line: mandated days are excluded from eligible working days entirely, so
those months carry a smaller requirement or none at all.

Three parallel components rather than generalising the `Period*` trio. Those three are
welded to `type="month"` inputs, a required `percent` field, and target-specific
consequence copy; threading a granularity prop, an optional-percent prop, and a
consequence-text prop through all three would cost more than the duplication saves, and
each new component is smaller than its counterpart.

- **`MandateForm`** — From / To `<input type="date">`, whose native value format is
  exactly `YYYY-MM-DD`, so nothing parses or reformats on either side. Plus an optional
  Reason text input. Hint: "Leave *To* blank for until further notice."
- **`MandateRow`** — range, reason beneath in `text-fade`, inline Edit mirroring
  `PeriodRow` (at most one row editable at a time), and delete. Sorted by `startDate`
  descending.
- **`DeleteMandateButton`** — native `<dialog>`, Cancel focused by default, stating the
  consequence rather than asking a generic "are you sure". Deleting a mandate silently
  returns its days to the eligible pool, which can flip a met month to unmet:

  > Delete the 12 Aug 2026 – 20 Aug 2026 mandate?
  > **7 working days** will count toward your requirement again.
  > [Cancel] [Delete mandate]

  Open-ended, where the count is unbounded: "Every working day from 12 Aug 2026 onward
  will count toward your requirement again."

The count comes from `countWeekdaysInMandate`, a pure helper, so the dialog needs no
extra round trip.

## Testing

Added to `src/lib/rto.test.ts` — pure functions in the existing `node` environment, no
new dependencies and no DOM, per the documented convention.

`isMandated`:
- date inside a closed mandate → true
- both boundary dates → true, proving inclusivity
- date one day before the start, one day after the end → false
- date inside an open-ended mandate → true
- a far-future date (`2099-01-01`) inside an open-ended mandate → true, pinning the
  `OPEN_ENDED_DATE` sentinel
- date before an open-ended mandate's start → false
- empty mandate list → false

`mandatesOverlap`:
- identical mandates → true
- sharing exactly one day at the boundary → true
- adjacent but not touching (`…08-20` and `08-21…`) → false
- one open-ended, starting before the other ends → true
- one open-ended, starting after the other ends → false
- both open-ended → true

`countWeekdaysInMandate`:
- `2026-08-12` → `2026-08-20` → `7`, the case the delete dialog quotes
- a single weekday → `1`; a single Saturday → `0`
- a full Mon–Sun week → `5`
- a range spanning a month boundary → correct across the seam
- open-ended → `null`

`isEligible` (weekday inputs only):
- untouched weekday → true
- `office` → true
- `leave`, `holiday` → false
- mandated, untouched → false
- mandated **and** `office` → false, the precedence rule
- mandated **and** `leave` → false

`computeMonthStats` with mandates:
- mandate from 12 Aug 2026 open-ended, no entries → `eligibleDays 7`, `requiredDays 3`,
  `mandatedDays 14`, proving partial-month proration. Unmandated August 2026 is 21
  eligible and 9 required, so the same month must move between those two results purely
  by the presence of the mandate
- fully mandated month → `eligibleDays 0`, `requiredDays 0`, `remainingNeeded 0`,
  `achievedPercent 0`, `mandatedDays > 0`
- fully mandated month with one `office` stamp inside it → `officeDays 0`,
  `achievedPercent 0`; asserts the stamp cannot push achieved above 100
- mandated day also marked `leave` → counted once, in `mandatedDays`, and
  `eligibleDays` matches the same month with that day merely mandated
- `weeks[]` denominators shrink; a fully mandated week is `{ eligibleDays: 0, officeDays: 0 }`
- open-ended mandate starting mid-month → later months in the range are fully mandated
- **no `mandates` argument** → every existing assertion holds unchanged, proving the
  default is a no-op

Server-action validation reachable without a database — the overlap rule and the
real-calendar-day check — is unit-testable; the date validator is extracted as a pure
exported helper so it can be, and covered with `2026-02-30`, `2026-02-28`,
`2024-02-29` (a real leap day), and `2026-13-01`.

## Documentation

- `CLAUDE.md` — the eligible-days formula becomes `weekdays − mandated − holidays −
  leaves`; document the new table, that mandate dates are `YYYY-MM-DD` text so range
  checks stay string comparisons, that overlaps are rejected, and that a mandate takes
  precedence over both a status entry and a target percent.
- `docs/architecture.md` — the eligible-days definition.
- `docs/decisions/0003-mandated-wfh-exclusions.md` — new ADR recording the separate-table
  choice over a 0% target period and over a fourth day status, matching the existing ADR
  convention.

## Rollout

No migration and no backfill. The table is new and starts empty, so `isMandated` is
false everywhere and behaviour is byte-identical to today until a mandate is added.
Schema goes out with `npx drizzle-kit push`, per the project's no-migrations-directory
convention.

The current mandate is then entered through the settings UI with a blank To field. Every
affected month — past and future — rescores at once, because a mandate is a statement
about a date range rather than about the days already recorded.

When the mandate is eventually lifted, the user edits the row and fills in the end date.
No new mechanism is needed for that.

## Out of scope

- Creating a mandate from the calendar (a "mandate from this day onward" control). The
  settings list is the one place ranges are managed.
- Half-days or partial-day exclusions.
- Sharing a mandate between users, or any org-wide policy source.
- Audit history of who changed a mandate and when.
- Notifying the user that a mandate rescored past months.

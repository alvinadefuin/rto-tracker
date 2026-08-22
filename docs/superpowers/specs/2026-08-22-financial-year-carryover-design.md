# Financial-year carryover — design

Date: 2026-08-22
Branch: `feat/financial-year-carryover`
Status: in review

## Problem

Two unrelated complaints, one spec, because both land in the same files.

**1. Target periods are typed, not picked.** `period-form.tsx` uses
`<input type="month">` while `mandate-form.tsx` uses `<input type="date">`. The month
control has no calendar popup in several browsers and degrades to a bare text field in
Safari, so adding a percentage period feels like filling in a form while adding a
mandate feels like picking a date. Same app, two interactions.

**2. Compliance is judged monthly; the employer judges it annually.** Today every
month stands alone: `computeMonthStats` returns `requiredDays` and `remainingNeeded`
for that month and nothing carries. The real rule is that attendance is assessed at the
end of each **financial year**, which runs August through July. Within a year, a
surplus in one month settles a shortfall in another — miss one day in February, work
an extra in March, and the year is level. Work 80% of June and July can be entirely
from home. At the end of July the slate is wiped; nothing crosses into the next year.

The app cannot express any of that, so it reports "1 to go" in a month that is already
covered by days banked earlier, and gives no answer at all to the only question that
matters in July: *am I short for the year?*

Worked example used throughout. FY2027 runs Aug 2026 – Jul 2027 and has 260 weekdays;
at 40% the year owes `ceil(260 × 40 / 100) = 104` office days.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| FY naming | Named for the calendar year it **ends** in: FY2027 = Aug 2026 – Jul 2027 | The user's convention. Aug 2026 is therefore month 1 of FY2027 |
| FY start month | `FY_START_MONTH = 8`, a hardcoded constant | One user, one employer. A settings row for it is unused configuration |
| Which FY is shown | The FY containing the **displayed** month, never the FY containing today | `today` is resolved client-side only (`useSyncExternalStore` with a null server snapshot) so SSR stays timezone-independent. An FY window keyed off today would reintroduce exactly the timezone dependency the app is built to avoid — and it would make browsing last July useless |
| Rounding | One `ceil` on the FY total: `ceil(Σ(eligible_m × pct_m) / 100)` | Matches an employer computing office ÷ eligible over the year. Twelve monthly round-ups cost about six extra days a year, which the user does not owe |
| Window end | Cumulative through the displayed month, inclusive | Mid-month it reads honestly as "behind" until days are stamped. Projecting unfinished future months would invent leave and holidays nobody has entered |
| Window start | Later of the FY's first month and the month of the user's earliest `day_entries` row | Otherwise browsing an FY that predates the app reports a ~100-day deficit that is technically true and completely useless |
| Two "to go" numbers | Month rings keep the month's own requirement; the FY line is the actionable one | Deliberate tension. The rings are the app's character and the daily unit of work; the FY sentence resolves them. The month's "N to go" renders in `text-fade` when the bank already covers it, so alarm colour appears only when the year actually owes days |
| Period granularity | Stays `YYYY-MM` in the database | A percentage that changes mid-month would split one month across two rates, complicating both the requirement maths and the copy, for a policy that changes at month boundaries anyway |
| Period input | `<input type="date">`, any day snapped to its month | Gives the mandate form's widget without the day-granular semantics. The row still renders "Aug 2026 – ongoing" |
| Migration | None | No schema change in this work |

## Part 1 — period inputs

### `src/lib/rto.ts`

```ts
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Month key for either a `YYYY-MM` key or a `YYYY-MM-DD` day, or null when the
 * value is neither. Accepting both is what lets the settings form post whole
 * dates while `rto_targets` keeps storing months.
 */
export function toMonthKey(value: string): string | null {
  if (MONTH_KEY_RE.test(value)) return value;
  if (isValidDateKey(value)) return value.slice(0, 7);
  return null;
}
```

`isValidDateKey` already rejects `2026-02-30`, so a hand-typed impossible date cannot
slip through to a truncation.

### `src/components/period-form.tsx`

Both inputs become `type="date"`. Names stay `startMonth` / `endMonth` — the action is
the only reader and it normalises. Editing a stored period seeds the first of the
month: `defaultValue={initial ? \`${initial.startMonth}-01\` : undefined}`, and the same
for `endMonth` when non-null. Hint copy becomes:

> Any day in the month works — periods run in whole months. Leave `To` blank for an
> ongoing period.

### `src/app/settings-actions.ts`

`parse` runs both values through `toMonthKey` and deletes its local `MONTH_RE`:

```ts
const startMonth = toMonthKey(String(formData.get("startMonth") ?? ""));
if (startMonth === null) return { ok: false, error: "Start month must be a valid date." };
```

The blank-means-ongoing step is unchanged and stays ahead of the normalisation: an empty
`endMonth` becomes `null` before `toMonthKey` ever sees it, so only a non-blank value is
validated as a date.

Everything downstream — `periodsOverlap`, `formatPeriodRange`, `resolvePercent` — is
untouched, because it still receives `YYYY-MM`. Existing rows and any caller still
posting a bare month key keep working.

## Part 2 — FY logic, all pure, all in `src/lib/rto.ts`

```ts
/** Financial years start in August. */
const FY_START_MONTH = 8;

/** FY containing `monthKey`, named for the calendar year it ends in. */
export function financialYearOf(monthKey: string): number;

/** First and last month of `fy`, inclusive. */
export function financialYearBounds(fy: number): {
  startMonth: string;
  endMonth: string;
};

/** `monthKey` shifted by `delta` months. Integer month math, never a Date parse. */
export function shiftMonthKey(monthKey: string, delta: number): string;

/** Inclusive `YYYY-MM` walk; `[]` when `start > end`. */
export function monthsBetween(start: string, end: string): string[];
```

`financialYearOf("2026-07")` is 2026; `financialYearOf("2026-08")` is 2027.

### Aggregating whole months

```ts
export interface MonthsAggregate {
  officeDays: number;
  /**
   * Σ (eligibleDays × targetPercent) across the months, in percent-points and
   * deliberately un-rounded. Dividing by 100 exactly once, at the end, is the
   * whole point: it is what makes the year owe 104 days instead of 110.
   */
  weightedEligible: number;
}

export function aggregateMonths(
  months: string[],
  entries: Entries,
  periods: TargetPeriod[],
  mandates: WfhMandate[]
): MonthsAggregate;
```

Per month it calls `resolvePercent` then `computeMonthStats`, and accumulates
`officeDays` and `eligibleDays × targetPercent`. Going through `computeMonthStats`
builds a `weeks` array nobody reads — accepted deliberately: eleven months of throwaway
arrays once per page render is nothing, and it keeps exactly one definition of an
eligible day. A second, leaner counting path is how the two drift apart.

### FY stats

```ts
export interface FyContext {
  fy: number;
  monthKey: string;          // the displayed month
  fyStartMonth: string;      // e.g. "2026-08"
  fyEndMonth: string;        // e.g. "2027-07"
  windowStartMonth: string;  // fyStartMonth, or later when tracking began mid-year
  prior: MonthsAggregate;    // months from windowStartMonth up to, not including, monthKey
}

export interface FyStats {
  fy: number;
  fyStartMonth: string;
  fyEndMonth: string;
  windowStartMonth: string;
  isPartialWindow: boolean;  // windowStartMonth > fyStartMonth
  isFinalMonth: boolean;     // monthKey === fyEndMonth
  cumulativeOffice: number;
  cumulativeRequired: number;
  balance: number;           // office − required; negative means days are owed
  remainingNeeded: number;   // max(0, −balance)
}

export function computeFyStats(ctx: FyContext, month: MonthStats): FyStats;
```

```
cumulativeOffice   = prior.officeDays + month.officeDays
weighted           = prior.weightedEligible + month.eligibleDays × month.targetPercent
cumulativeRequired = ceil(weighted / 100)
balance            = cumulativeOffice − cumulativeRequired
remainingNeeded    = max(0, −balance)
```

`isFinalMonth` and `isPartialWindow` are string comparisons on month keys, so no part
of this consults the clock.

When the displayed month is the FY's first month, `prior` is `{0, 0}` and the FY figures
equal the month's own. That duplication is left in rather than special-cased: the block
still answers "am I short for the year", and suppressing it would make the panel appear
and disappear as you slide months.

### Reuse cleanup

- `page.tsx` drops its local `shiftMonth` and `MONTH_RE` in favour of `shiftMonthKey`
  and `toMonthKey`.
- `settings-actions.ts` drops its `MONTH_RE`.
- New `mandateTouchesMonth(mandate, monthKey)` in `rto.ts`, needed because the mandates
  query widens to the FY window while the page banner must stay month-scoped.

## Data flow

`src/app/page.tsx`, in order:

```ts
const fy = financialYearOf(monthKey);
const { startMonth: fyStartMonth, endMonth: fyEndMonth } = financialYearBounds(fy);

// Month the record begins. One aggregate, no rows returned.
const [{ first }] = await db
  .select({ first: min(dayEntries.date) })
  .from(dayEntries)
  .where(eq(dayEntries.userId, session.user.id));

const trackingStart = first ? first.slice(0, 7) : null;
const windowStart =
  trackingStart === null
    ? null
    : trackingStart > fyStartMonth
      ? trackingStart
      : fyStartMonth;

// Nothing was ever recorded at or before this month, so there is no FY history to
// carry — and the displayed month is necessarily empty too, since trackingStart is
// the earliest row that exists.
const fyTracked = windowStart !== null && windowStart <= monthKey;
const queryStart = fyTracked ? windowStart : monthKey;
```

- **`day_entries`** widens from one month to `[${queryStart}-01, ${monthKey}-31]`. At
  most twelve months of one user's rows.
- **`wfh_mandates`** widens the same way: `startDate <= ${monthKey}-31` and
  (`endDate IS NULL` or `endDate >= ${queryStart}-01`). The header banner then filters
  with `mandateTouchesMonth` so it keeps listing only the displayed month's mandates.
  The window-wide list is safe to hand to `Calendar` — `isMandated` matches on dates,
  and a mandate outside the month matches none of its days.
- **`rto_targets`** is already fetched whole; `aggregateMonths` needs all of it.

Rows are split by prefix: keys starting with `monthKey` become `initialEntries` for
`Calendar`; the whole window feeds the aggregate.

```ts
const prior = fyTracked
  ? aggregateMonths(
      monthsBetween(windowStart, shiftMonthKey(monthKey, -1)),
      windowEntries,
      periodRows,
      mandates
    )
  : null;

const fyContext = fyTracked
  ? { fy, monthKey, fyStartMonth, fyEndMonth, windowStartMonth: windowStart, prior }
  : null;
```

`monthsBetween` returns `[]` when the displayed month is the window's first, giving the
`{0, 0}` aggregate for free.

### Why the client gets numbers, not entries

`Calendar` recomputes stats locally after every tap, so it needs the FY figures to be
recomputable client-side. It receives `fyContext` — **two numbers plus month keys, not
the earlier months' entries.** Only the displayed month is editable from this view, so
everything before it is constant for the lifetime of the mount. The client adds its
live month to the fixed prior and re-runs the same single `ceil`:

```ts
const stats = computeMonthStats(year, month, entries, targetPercent, mandates);
const fyStats = fyContext ? computeFyStats(fyContext, stats) : null;
```

No extra rows cross the wire and the arithmetic stays isomorphic — the same property
`computeMonthStats` already has, and the reason `Calendar` can stay optimistic.

`key={monthKey}` on `<Calendar>` remains load-bearing and gains a second reason:
`fyContext` is also seeded on mount only.

## Stats UI — `src/components/stats.tsx`

Signature becomes `Stats({ stats, fy }: { stats: MonthStats; fy: FyStats | null })`.

The existing all-mandated early return has to go: it currently `return`s before
anything else can render, and the FY block must appear under it. Split the body into a
local `MonthBlock` (rings, or the mandated-month copy) and an `FyBlock`, and render
both, separated by a hairline `border-t border-rule`. Layout as approved: month block,
rule, FY block, then the grid — one column, identical on phone and desktop.

### Month block change

Exactly one: the `remainingNeeded > 0` figure is `text-stamp` only when the year agrees
days are owed, otherwise `text-fade`.

```ts
const owedForYear = fy === null || fy.remainingNeeded > 0;
```

### FY block

Heading, `font-mono` small caps like the other section labels:

> `FY2027 · Aug 2026 – Jul 2027`

with ` · counted from Oct 2026` appended when `isPartialWindow` — the window start
is always inside the FY, never before it.

Meter: a single horizontal bar, `aria-hidden`, filled
`min(100, round(cumulativeOffice / cumulativeRequired × 100))%` — full when
`cumulativeRequired === 0`. Surplus is shown as `+{balance}` in `text-stamp` beside it,
mirroring the `+{extra}` the rings already use. As with the rings, the bar carries no
information the text does not.

Figures line: `{cumulativeOffice}/{cumulativeRequired} to date`, or `for the year` when
`isFinalMonth`.

Verdict sentence:

| Condition | Copy |
|---|---|
| `cumulativeRequired === 0` | No requirement so far — every counted day was mandated WFH. |
| `balance > 0`, final month | `{balance} days ahead — FY2027 met.` |
| `balance > 0`, month still owes | `{balance} days ahead — this month's {n} remaining are covered.` |
| `balance > 0`, month covered | `{balance} days ahead — banked toward later months.` |
| `balance === 0`, final month | Level — FY2027 met exactly. |
| `balance === 0` | Level — no days banked. |
| `balance < 0`, final month | `{n} office days short — FY2027 not met.` |
| `balance < 0` | `{n} more office days needed to be level.` |

Singular forms where `n === 1`.

### Worked screens

Viewing **Oct 2026**, all days eligible, 40% throughout, 12 stamped in August and 11 in
September, 6 so far in October:

```
●●●●●●○○○  6/9 stamped · 3 to go · 27%      ← "3 to go" in fade
9 office days required — 40% of 22 eligible working days this month.
──────────────────────────────────────────────────────────────────
FY2027 · Aug 2026 – Jul 2027
████████████████████████  29/26 to date  +3
3 days ahead — this month's 3 remaining are covered.
```

Monthly round-ups would have owed 27 by October; one round-up on 2,600 percent-points
owes 26.

Viewing **Jul 2027** after a June that left the year exactly level — 104 office days
banked against a 104-day year, some of them the extra days worked in June:

```
○○○○○○○○○  0/9 stamped · 9 to go · 0%       ← in fade: the year owes nothing
──────────────────────────────────────────────────────────────────
FY2027 · Aug 2026 – Jul 2027
████████████████████████  104/104 for the year
Level — FY2027 met exactly.
```

July can be worked entirely from home, which is the behaviour asked for.

## Testing — `src/lib/rto.test.ts`

Vitest covers `rto.ts` only, which is where all of this lives.

**FY boundaries.** `financialYearOf` for `2026-07` → 2026, `2026-08` → 2027,
`2027-01` → 2027, `2027-07` → 2027, `2027-08` → 2028. `financialYearBounds(2027)` →
`{ "2026-08", "2027-07" }`, and `financialYearOf(bounds.startMonth) === 2027` as a
round-trip.

**Month math.** `shiftMonthKey("2026-01", -1)` → `2025-12`;
`shiftMonthKey("2026-12", 1)` → `2027-01`; `shiftMonthKey("2026-03", -14)` → `2025-01`.
`monthsBetween("2026-11", "2027-02")` → four keys across the year end; single month →
one key; `start > end` → `[]`.

**`toMonthKey`.** `2026-08` → itself; `2026-08-12` → `2026-08`; `2026-02-30` → null
(the day is impossible); `2026-13` → null; `""` → null.

**`aggregateMonths`.** Aug + Sep 2026 with no entries and no periods → `officeDays 0`,
`weightedEligible (21 + 22) × 40 = 1720`. A 60% period covering September only →
`21 × 40 + 22 × 60 = 2160`, proving the percentage is resolved per month rather than
once. Leave, holiday and mandated days each reduce the weighted total. `[]` → `{0, 0}`.

**One ceil, not twelve.** The Oct 2026 example: prior `{ officeDays: 23,
weightedEligible: 1720 }` plus a 22-day 40% October gives `cumulativeRequired 26`, and
the test asserts 26 explicitly against the 27 that summing monthly `ceil`s produces.

**Balance signs.** Positive, zero and negative balances; `remainingNeeded` is
`max(0, −balance)` and never negative.

**The June-into-July case.** `prior = { officeDays: 20, weightedEligible: 1100 }` →
11 required, balance +9. July adds 22 eligible days at 40% → weighted 1,980 →
`cumulativeRequired 20`; with no July office days, `cumulativeOffice 20`, balance 0,
`remainingNeeded 0`. A whole month worked from home, still level.

**Degenerate FY.** Every counted day mandated → `cumulativeRequired 0`, `balance` equal
to `cumulativeOffice`, no division by zero.

**`isFinalMonth`.** True for `2027-07` in FY2027, false for `2027-06` and for
`2027-08` — the latter belonging to FY2028 at all is itself the assertion.

**`mandateTouchesMonth`.** An open-ended mandate starting in a previous month touches
this one; a mandate ending before the month starts does not; one starting after it ends
does not; single-day mandates on the first and last of the month do.

## Documentation

- **`CLAUDE.md`** — a paragraph in Architecture stating the FY runs Aug–Jul and is
  named for its ending year; that compliance is cumulative within an FY and resets at
  the boundary; that the FY is derived from the **displayed** month and never from
  `today`, for the same timezone reason the rest of the app cites; and that
  `weightedEligible` is deliberately un-rounded so the year rounds once. Also that
  `rto_targets` still stores `YYYY-MM` even though the form now posts whole dates.
- **`docs/architecture.md`** — the same, at its level of detail.
- **`docs/decisions/0005-financial-year-carryover.md`** — new ADR, following 0002 and
  0003: the annual-assessment problem, single-ceil rounding, the displayed-month window,
  the tracking-start floor, and the accepted two-numbers tension.

## Rollout

No migration and no schema change, so the deploy is code only and the expand/contract
rule does not apply. Two added queries per calendar render: one `min(date)` aggregate,
and a `day_entries` range that grows from one month to at most twelve for a single
user. Both are indexed by the `(user_id, date)` primary key.

Nothing recorded changes meaning. Existing `rto_targets` rows keep their month keys, and
every month's own requirement still reads exactly as it does today — the FY block only
adds an answer that was previously unavailable.

## Out of scope

- A configurable FY start month.
- Day-granular target percentages, and the split-month requirement they imply.
- A dedicated FY overview page, or a table of past financial years.
- Projecting unfinished months into a full-year target figure.
- Backfilling or importing months from before the record starts.
- Carrying a surplus or shortfall across an FY boundary. The reset is the point.

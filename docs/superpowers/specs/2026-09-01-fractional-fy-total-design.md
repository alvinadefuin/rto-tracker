# The financial-year total is fractional too

**Date:** 2026-09-01
**Status:** approved, not yet implemented

## Why

ADR 0006 made the month's requirement exact: 13 eligible days at 40% is 5.2, not
6. The fraction was never meant to be forgiven — it carries into the financial
year, where `aggregateMonths` sums each month's un-rounded `requiredPoints` into
`weightedEligible`.

`computeFyStats` then hides it:

```ts
const cumulativeRequired = Math.ceil(weighted / 100);   // 520 -> 6
```

So a user who owed 5.2 and stamped 5 is told the year needs **1 more office
day**. The true carried debt is 0.2. The number they were shown a line earlier —
"0.2 to go" for the month — vanishes and reappears as a whole day, which reads
as the fraction being rounded away rather than carried.

The `ceil` was deliberate (ADR 0005), on the reasoning that a fifth of a day
cannot be worked. That reasoning is about **what clears the debt**, not about
**how large the debt is**, and it turns out the first survives without it.

## Decisions

**The financial year holds its requirement in un-rounded percent-points, exactly
as the month does.** There is no `Math.ceil` left anywhere in the FY path.

**The met/not-met boundary does not move.** For an integer `cumulativeOffice`:

```
cumulativeOffice * 100 >= P   <=>   cumulativeOffice >= ceil(P / 100)
```

Clearing a 104.4-day year still takes 105 whole days either way. Concretely,
`remainingNeededPoints > 0` is true in exactly the cases `remainingNeeded > 0`
was, so `owedForYear` — the flag that mutes the month card's alarm and
celebration colours in `stats.tsx` — is bit-for-bit unchanged.

**What does move is the split between "level" and "ahead", in the direction of
being more truthful.** 6 office days against a 5.2 requirement used to report
`balance === 0`, "Level — no days banked." It now reports +0.8, which is what
the year will really credit against a later month. `Level` becomes a rare
branch: it needs the year's total to land on a whole day *and* be met exactly.

**The progress block gains one state-aware sentence** naming where a month's
unpaid fraction went. It appears only when the month has a remainder the year
has not already covered — when the year is ahead, `fyVerdict` already says the
month's remainder is covered, and a second sentence would argue with the first.

Rejected alternatives:

- **Keep the field names, change the units to floats** (`cumulativeRequired:
  5.2`). Puts `balance === 0` — the level test — back on float arithmetic, which
  is the one thing ADR 0006 introduced points to avoid. Worse, every existing
  call site keeps compiling against a number that silently means something else.
  Renaming the fields makes the compiler walk to all four consumers.
- **Keep the `ceil` for the displayed total and add exact fields beside it.**
  Two requirement figures for one year, and `MonthStats` already learned in ADR
  0006 that a day-valued sibling next to a points field is an invitation to
  compare the wrong one.
- **Fold the carry into next month's own target** — next month asks for its own
  5.2 plus 0.2 carried. Most literal reading of "carried over to next month",
  but the month stops being `eligible × percent`, which is the figure the
  employer states, and the month card and the FY line would then bill the same
  0.2 twice.
- **An always-on caption stating the carry rule.** Cannot be missed, but it is a
  sentence that never changes, and every other string in `rto.ts` is chosen for
  the state it describes rather than asserting a general rule.

## Design

### `FyStats` in percent-points

```ts
export interface FyStats {
  fy: number;
  fyStartMonth: string;
  fyEndMonth: string;
  windowStartMonth: string;
  isPartialWindow: boolean;
  isFinalMonth: boolean;
  cumulativeOffice: number;           // whole days stamped — a count, not points
  cumulativeRequiredPoints: number;   // Σ requiredPoints across the window, un-rounded
  balancePoints: number;              // cumulativeOffice × 100 − cumulativeRequiredPoints
  remainingNeededPoints: number;      // max(0, −balancePoints)
}
```

```ts
const cumulativeOffice         = baseline.prior.officeDays + monthStats.officeDays;
const cumulativeRequiredPoints = baseline.prior.weightedEligible + monthStats.requiredPoints;
const balancePoints            = cumulativeOffice * 100 - cumulativeRequiredPoints;
const remainingNeededPoints    = Math.max(0, -balancePoints);
```

Every operand is an integer, so `balancePoints === 0` stays an exact level test
and `balancePoints` is the only signed quantity in the file. `cumulativeOffice`
stays a whole day count — it is a tally of stamps, and multiplying it by 100 at
the one place it meets points is clearer than storing it pre-scaled.

The three renames are load-bearing, not cosmetic. `cumulativeRequired` held
days; `cumulativeRequiredPoints` holds hundredths. Any call site left unconverted
would keep type-checking against a `number` that is now 100× larger, and would
render "5/520 to date". Renaming turns each one into a compile error.

`MonthsAggregate.weightedEligible` is unchanged, but its doc comment is not: it
currently explains the sum exists so `computeFyStats` can divide by 100 exactly
once. After this there is no division in the FY path at all — `formatDays` at
the display edge is the only place points become days.

### Verdict copy

`plural(n, one, many)` is used only by `fyVerdict` and converts wholesale to a
points-aware sibling:

```ts
const dayCount = (points: number, one: string, many: string) =>
  `${formatDays(points)} ${points === 100 ? one : many}`;
```

`100 → "1 day"`, `20 → "0.2 days"`, `250 → "2.5 days"`. The `=== 100` singular
rule already existed inline in the branch that quotes the month's remainder;
that branch now calls `dayCount` too, so the rule has one definition instead of
two. `formatDays` takes a non-negative integer, so the owed branches pass
`-fy.balancePoints` as they already pass `-fy.balance`.

The eight branches keep their shape and their existing carefully-worded
`isFinalMonth` handling. Only their numbers sharpen:

| before | after |
| --- | --- |
| `1 more office day needed to be level.` | `0.2 more office days needed to be level.` |
| `1 day ahead — banked toward later months.` | `0.8 days ahead — banked toward later months.` |
| `1 office day short of FY2027's full year.` | `0.4 office days short of FY2027's full year.` |
| `Level — no days banked.` | unchanged, but now rare |

`No requirement — the year owes nothing.` keys off
`cumulativeRequiredPoints === 0`, which is the same condition as before —
`ceil(0) === 0`.

### The carry note

A separate exported function rather than a clause bolted onto eight branches:

```ts
export function fyCarryNote(fy: FyStats, monthStats: MonthStats): string | null
```

Returns `null` unless **both** `monthStats.remainingPoints > 0` and
`fy.remainingNeededPoints > 0`. The first is the fraction being explained; the
second is what keeps it from contradicting the `balance > 0` branch of
`fyVerdict`, which already reports the month's remainder as covered.

```
Fractions carry — this month's 0.2 is already in FY2027's total above, and
settles against a later month rather than raising next month's own target.
```

July has no later month, so `isFinalMonth` gets its own wording:

```
Fractions carry, but only within the year — this month's 0.2 is in FY2027's
total above, and July is its last month, so nothing settles it later.
```

Phrased as a month comparison, never as time having passed. `isFinalMonth` is
`monthKey === fyEndMonth` and knows nothing about a clock, so eleven presses of
the next-month arrow reach a July that has not happened — the same trap the
existing verdict branches are worded around.

It lives in `rto.ts`, beside `fyVerdict`, for the reason that file already
gives: Vitest runs in a `node` environment, so copy assembled inside JSX cannot
be asserted.

### `src/components/stats.tsx`

Four edits in `FyBlock`, one in `MonthBlock`:

| line | change |
| --- | --- |
| `:72` | `owedForYear` reads `remainingNeededPoints > 0` — same boolean, new field name |
| `:146` | destructure `cumulativeRequiredPoints`, `balancePoints` |
| `:151-154` | `fillPercent` becomes integer math (below) |
| `:176` | `{cumulativeOffice}/{formatDays(cumulativeRequiredPoints)}` |
| `:178` | `+{formatDays(balancePoints)}` |

```ts
const fillPercent =
  cumulativeRequiredPoints === 0
    ? 100
    : Math.min(100, Math.floor((cumulativeOffice * 10000) / cumulativeRequiredPoints));
```

The `=== 0 → 100` guard and the `floor` both stay, for the reasons already
commented there: an empty bar against a zero target reads as no progress rather
than no obligation, and rounding would draw a solid bar above "1 office day
short". The bar also gets more accurate — 5 stamped against 5.2 was drawn at
`floor(5/6) = 83%` and is now 96%.

`FyBlock` calls `fyCarryNote(fyStats, monthStats)` beside the `fyVerdict` call it
already makes, and renders the result as its own `text-sm text-fade` paragraph
under the verdict, skipped when `null`. Nothing about the month card, the stamp
rings, or `monthMeter` changes.

### Docs

- **ADR 0007**, `docs/decisions/0007-fractional-financial-year-total.md`.
- **ADR 0005** — its Decision block still reads `cumulativeRequired =
  ceil(weightedEligible / 100)`, and a Consequence still says per-month figures
  do not sum to the FY figure "because the year rounds once". Both amended in
  place with a pointer to 0007, per the convention 0006 set rather than by
  rewriting history.
- **ADR 0006** — the Consequence headed "The year is stricter than the sum of
  its months" is exactly what stops being true. Amended in place.
- `docs/architecture.md` — the two bullets at `:48-51` and `:57-58`.
- `CLAUDE.md` — the FY paragraph's "divides by 100 and rounds up exactly once
  for the year". The neighbouring warning against rounding each month and
  summing those still stands and stays.

## Testing

Test-driven. The blast radius is `src/lib/rto.test.ts`: the `computeFyStats`
block from `:939` and the `fyVerdict` block from `:1075`, whose `stats()` helper
fixture carries `cumulativeRequired`, `balance` and `remainingNeeded`. Every
assertion is **rewritten to its exact points value**, not deleted — a deleted
assertion is lost coverage, a rewritten one records the new rule. `:971`'s
"rounds once on the FY total, not once per month" is renamed to say the total is
never rounded, and keeps its comparison against the sum of per-month `ceil`s,
which is still the alternative being rejected.

New coverage:

- **The boundary is unchanged.** A year owing 10440 points reports a shortfall at
  104 office days and a surplus at 105 — the same verdict `ceil(104.4) = 105`
  gave, now with 0.4 and +0.6 as the magnitudes.
- **The fraction survives the round trip.** 13 eligible at 40% with 5 stamped and
  an empty prior window: `cumulativeRequiredPoints === 520`,
  `balancePoints === -20`, verdict `0.2 more office days needed to be level.`
- **A fractional surplus is banked, not levelled away.** The same month with 6
  stamped: `balancePoints === 80`, not 0.
- **`remainingNeededPoints > 0` matches the old `remainingNeeded > 0`** across a
  fractional requirement at every office-day count either side of it. This is
  the property the whole change rests on, so it is asserted rather than argued.
- **`fyCarryNote`** — null when the month is met, null when the year is ahead,
  the standard sentence when both conditions hold, and the July variant when
  `isFinalMonth`.
- **`dayCount`** singular at exactly 100 points, plural at 20 and at 250.

`make test` and `make lint` before the work is called done.

## Out of scope

- **The month card, rings and `monthMeter`.** The month already never rounded;
  only the year did. `monthMeter.extra` stays a count of whole surplus rings
  rather than the exact surplus, and its comment stays accurate: `slots` rounds
  the requirement up, so `extra` can only understate what the year credits, and
  understating is the safe direction.
- **Showing a carried-in balance on the month card.** The number is derivable
  from `FyBaseline.prior`, and was considered. It would put a third shortfall
  figure on screen beside the month's and the year's, and ADR 0005 already
  treats two as the deliberate maximum.
- **Rounding the July figure up for actionability.** A final month reporting 0.4
  short does need a whole day worked. The verdict says the size of the debt; the
  carry note says the year ends here. Neither invents a number.
- **The FY boundary, the window start rule, and `fyWindowStart`.** Untouched.

# Covered rings

**Date:** 2026-11-26
**Status:** implemented

## Why

A surplus banked earlier in the financial year already settles part of this
month's requirement — the FY block says so, and `owedForYear` greys this
month's "to go" once the year is covered. The month's rings do not: they still
draw every unstamped ring as owed. The rings should say what the text says.

## What this is not

Covered rings are **not** stamps. They are not filled, not drawn in `stamp`,
and do not count toward `officeDays` or the `officeDays/required stamped`
figure. The month's requirement does not change either — `fyCarryNote`'s
"Next month's target does not change" stays true. A deficit adds no rings;
only a surplus marks existing ones.

## Design

**The surplus is the year's balance before this month.**

```
priorBalancePoints = fyStats.balancePoints
                   − (monthStats.officeDays × 100 − monthStats.requiredPoints)
```

which equals `prior.officeDays × 100 − prior.weightedEligible`. It is derived
from what `Stats` already receives, so no new props. It is fixed for the
month: stamping this month never moves it, so rings do not shift under the
user's finger. When `fyStats` is `null`, or the value is ≤ 0 (a deficit, or
August with no prior months), there are no covered rings — today's behaviour.

**How many rings are covered.**

```
covered = max(0, slots − ceil(max(0, requiredPoints − priorBalancePoints) / 100))
```

That is: how many whole stamps this month still needs for the year to stay
level, subtracted from the row. The outer `max(0, …)` is load-bearing: a
deficit makes "still needed" exceed `slots`. It is deliberately not
`floor(priorBalancePoints / 100)`, which would leave a fractional surplus
unable to cover the fractional last ring. In points, with `requiredPoints` 880
(8.8 days, 9 rings):

| priorBalancePoints | still needed | covered |
| ------------------ | ------------ | ------- |
| 80                 | 800 → 8      | 1       |
| 140                | 740 → 8      | 1       |
| 200                | 680 → 7      | 2       |
| 20                 | 860 → 9      | 0       |
| 1000               | 0 → 0        | 9       |
| −300               | 1180 → 12    | 0       |

The property this buys: whenever `priorBalancePoints ≥ 0`, for any integer
stamp count, `filled + covered ≥ slots` exactly when `fyStats.remainingNeededPoints === 0` — so the rings complete
precisely when `owedForYear` greys the month's "to go". The two cannot
disagree. With a prior deficit there is nothing to cover, the rings complete
at the month's own requirement exactly as today, and `owedForYear` keeps
"target met" faded while the year still owes. A month with `requiredPoints` 0 has 0 slots and 0 covered.

**Placement.** Covered rings occupy the **right** end of the row: ring `i` is
covered when `i ≥ slots − covered` and it is not stamped. Stamps still fill
from the left, so the user watches the gap between them close. The partial
last ring is the first one covered — a small obligation is the first thing a
surplus settles — and a covered ring draws no partial gradient.

**A stamp beats a cover.** Ring `i < filled` is drawn stamped whatever
`covered` says. Stamping past the gap simply stamps over covered rings.
`extra` is unchanged.

**Style.** A dashed `border-holiday` ring, unfilled. Holiday green already
means "target met" in this block; dashed and hollow keeps it distinct from a
solid stamp at ring size.

**Text.** The ring row is `aria-hidden` on the premise that it carries nothing
the text does not; covered rings would break that. The month's caption line
gains a clause when `covered > 0`:

> … eligible working days this month · 2 covered by earlier months' surplus.

The count is of rings, not points, and "1 covered …" reads the same as the
plural, so only the number varies. The clause is built by a function in `rto.ts`, not in JSX,
so it can be asserted.

The clause counts the dashed rings shown, so stamps that overrun the covered
block reduce it.

## Code

- `src/lib/rto.ts`
  - `priorBalancePoints(fy: FyStats, month: MonthStats): number`.
  - `monthMeter(stats, priorBalancePoints = 0)` returns a new
    `covered: number` field; the existing fields are unchanged. Its doc
    comment gains the reasoning above (why not `floor`, the
    `owedForYear` equivalence).
  - `coveredNote(meter): string | null` — the caption clause, `null` at 0.
- `src/components/stats.tsx` — `MonthBlock` passes
  `fyStats ? priorBalancePoints(fyStats, stats) : 0` to `monthMeter`, draws
  the third ring state, and appends `coveredNote`. The `Stats` header comment
  mentions covered rings.

## Tests (`src/lib/rto.test.ts`)

- `monthMeter` covered counts: every row of the table above.
- Default argument: `monthMeter(stats)` gives `covered: 0`.
- Clamp: a prior deficit gives `covered: 0`, never negative.
- Equivalence: for a spread of `requiredPoints`, non-negative prior balances
  and stamp counts, `filled + covered ≥ slots` iff
  `computeFyStats(...).remainingNeededPoints === 0`.
- `priorBalancePoints` round-trips: equals
  `baseline.prior.officeDays × 100 − baseline.prior.weightedEligible` for a
  `computeFyStats` result.
- `coveredNote`: `null` at 0, the sentence otherwise.

The stamp-beats-cover rule and placement live in JSX and stay untested, like
the existing partial-ring rule.

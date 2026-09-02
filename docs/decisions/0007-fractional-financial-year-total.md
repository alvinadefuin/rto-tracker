# 0007 — The financial-year total is fractional too

## Context

ADR 0006 made the month's requirement exact: 13 eligible days at 40% is 5.2, not
6. The fraction was never forgiven — `aggregateMonths` sums each month's
un-rounded `requiredPoints` into `weightedEligible`, and the financial year is
where it settles.

`computeFyStats` then hid it:

    cumulativeRequired = ceil(weightedEligible / 100)     // 520 -> 6

A user who owed 5.2 and stamped 5 was told the year needed **1 more office day**.
The carried debt is 0.2. The figure shown a line earlier — "0.2 to go" on the
month card — vanished and came back as a whole day, which reads as the fraction
being rounded away rather than carried.

ADR 0005 put the `ceil` there on the reasoning that a fifth of a day cannot be
worked. That is a statement about **what clears the debt**, not about **how large
the debt is**, and the first survives without it.

## Decision

The financial year holds its requirement in un-rounded percent-points, exactly as
the month does. There is no `Math.ceil` anywhere in the FY path.

    cumulativeRequiredPoints = Σ (eligibleDays_m × percent_m)   // never divided
    balancePoints            = cumulativeOffice × 100 − cumulativeRequiredPoints
    remainingNeededPoints    = max(0, −balancePoints)

**No verdict boundary moves.** For an integer `cumulativeOffice`:

    cumulativeOffice × 100 ≥ P   ⟺   cumulativeOffice ≥ ceil(P / 100)

Clearing a 104.4-day year still takes 105 whole days. `remainingNeededPoints > 0`
is true in exactly the cases `remainingNeeded > 0` was, so `owedForYear` — the
flag that mutes the month card's alarm and celebration colours — is unchanged.

What moves is the split between *level* and *ahead*, in the direction of the
truth: 20 days stamped against 19.8 owed used to report `balance === 0`, "Level —
no days banked", and now reports +0.2, which is what the year really credits
against a later month.

The progress block also gains `fyCarryNote`, one state-aware sentence naming
where a month's unpaid fraction went. It renders only when the month has a
remainder **and** the year is still owed — when the year is ahead, `fyVerdict`
already reports the remainder covered.

Rejected alternatives:

- **Floats instead of points** (`cumulativeRequired: 5.2`). Puts `balance === 0`
  — the level test — back on float arithmetic, the one thing ADR 0006 introduced
  points to avoid. Worse, keeping the field names lets every call site compile
  against a number that silently means something else; renaming all three made
  the compiler find them.
- **Keeping the `ceil` for display and adding exact fields beside it.** Two
  requirement figures for one year. ADR 0006 already learned that a day-valued
  sibling next to a points field is an invitation to compare the wrong one, and
  deleted `requiredDays` for it.
- **Folding the carry into next month's own target** — next month asks for its
  own 5.2 plus 0.2 carried. The most literal reading of "carried over to next
  month", but the month stops being `eligible × percent`, which is the figure the
  employer states, and the month card and the FY line would bill the same 0.2
  twice.
- **An always-on caption stating the carry rule.** Cannot be missed, but it is a
  sentence that never changes, where every other string in `rto.ts` is chosen for
  the state it describes.

## Consequences

- ADR 0005's `cumulativeRequired = ceil(…)` and ADR 0006's "the year is stricter
  than the sum of its months" are both superseded, and marked in place.
- **Per-month points now sum to the FY figure exactly.** The FY line stays the
  authoritative one, but for a different reason than before: it is the only
  figure that spans the window, not because it rounds differently.
- `Level` becomes a rare branch of `fyVerdict` — it needs the year's total to
  land on a whole day *and* be met exactly. Most months now read as slightly
  ahead or slightly behind, which is what they are.
- The FY bar gets more accurate as a side effect: 5 stamped against 5.2 was drawn
  at `floor(5/6) = 83%` and is now 96%. Its `floor` and its `=== 0 → 100%` guard
  both stay, for the reasons already commented at the call site.
- A final month can now report a sub-day shortfall — "0.4 office days short of
  FY2027's full year" — where clearing it takes a whole day. The verdict states
  the size of the debt and the carry note states that the year ends in July;
  neither invents a number, and rounding one of them up would put a figure on
  screen that no arithmetic in the app produces.
- `monthMeter` is untouched. `extra` still counts whole surplus rings rather than
  the exact surplus: `slots` rounds the requirement up, so `extra` can only
  understate what the year credits, and understating is the safe direction.
- No schema change, no migration, no query change. `FyBaseline` — the only part
  of this that crosses the server/client boundary — keeps its shape.

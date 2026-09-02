# 0005 — Financial-year carryover

## Context

Attendance is assessed at the end of each financial year, which runs August through
July, not month by month. Within a year a surplus settles a shortfall: a day missed in
February can be worked in March, and a June worked at 80% can pay for a July worked
entirely from home. At the July boundary the slate is wiped.

The app judged each month alone. It reported "1 to go" in a month already covered by
days banked earlier, and had no answer at all to the only question that matters in
July: am I short for the year?

## Decision

Carry a running balance within the FY containing the **displayed** month, and round the
requirement **once** on the year's total:

```
weightedEligible   = Σ (eligibleDays_m × percent_m)      // percent-points, un-rounded
cumulativeRequired = ceil(weightedEligible / 100)
balance            = cumulativeOffice − cumulativeRequired
```

**Amended 2026-09-01 by ADR 0007:** the `ceil` is gone. The year now holds
`cumulativeRequiredPoints = Σ (eligibleDays_m × percent_m)` in points and
`balancePoints = cumulativeOffice × 100 − cumulativeRequiredPoints`. No verdict
boundary moved — for an integer day count the two forms agree on whether the year
is owed — but every magnitude reported is now exact.

FY2027 means Aug 2026 – Jul 2027 — named for the year it ends in, the user's own
convention. `FY_START_MONTH` is a hardcoded constant, not a setting: one employer, one
calendar.

Rejected alternatives:

- **Summing per-month `ceil`s.** Every month would carry an integer requirement and its
  own ±N, and the FY line would be the literal sum of the rows above it. But twelve
  round-ups instead of one bill about six office days a year the user does not owe. The
  employer computes office ÷ eligible over the year; so do we.
- **Keying the window off today's date.** Would make the FY block silently wrong for any
  month being reviewed, and would make server-rendered output depend on the server's
  timezone — the one thing the whole date layer is built to avoid.
- **Projecting the unfinished months into a full-year target.** A single figure for the
  year is tempting, but future months' leave and holidays are unknown, so it would
  invent absences nobody entered.
- **Replacing the monthly meter with the FY meter.** By July the year's requirement is
  around 100 days, which no stamp-ring row can render, and the month is still the unit
  the user acts in.

## Consequences

- Two "to go" numbers are on screen: the month's own, and the year's. Deliberate. The
  rings keep the month's truth; the FY sentence is the actionable one, and the month's
  shortfall loses its alarm colour when the bank already covers it.
- Per-month figures no longer sum to the FY figure, because the year rounds once. The FY
  line is authoritative.
  **Amended 2026-09-01 by ADR 0007:** the year no longer rounds, so per-month
  points do sum to the FY figure exactly. The FY line stays authoritative for a
  different reason — it is the only figure that spans the window.
- A shortfall carries forward as well as a surplus: a missed February raises March's
  effective need. That is symmetry, not a bug.
- The window starts no earlier than the month of the first recorded day. An FY that
  predates the app therefore reports nothing rather than a ~100-day deficit for months
  that were never tracked — at the cost of a partial year's total not matching what the
  employer would compute for that year. The block says `counted from <month>` when so.
- Reviewing a past FY works, and reviewing a month before the record starts shows no FY
  block at all.
- Browsing *forward* has no matching floor. Eleven presses of the next-month arrow reach
  next July and show that year's full requirement against whatever is recorded so far,
  which is usually nothing. `isFinalMonth` compares month keys and cannot know whether
  the year has happened, so the verdict is worded as a shortfall against the full year
  rather than as a year not met.
- Nothing crosses a July boundary. A surplus banked in FY2027 is gone in FY2028.
- No schema change: the balance is derived on every render from `day_entries`,
  `rto_targets` and `wfh_mandates`. The cost is one extra aggregate query, a
  `day_entries` range of at most twelve months for one user, and the `wfh_mandates`
  query widened from the displayed month to that same window — the aggregate needs the
  earlier months' exclusions too. Each still reads through a `(user_id, …)` index — the
  `day_entries` primary key, and `wfh_mandates_user_start_idx`.
- `page.tsx` sends the client two numbers for the prior months rather than their entries,
  so the FY figures stay recomputable locally without shipping the year's history.
- Dropping the page's own `MONTH_RE` for `toMonthKey` widened `?m=` to accept a full
  `YYYY-MM-DD` date, which normalises to its month. A link to a day now shows that day's
  month rather than falling back to today's.

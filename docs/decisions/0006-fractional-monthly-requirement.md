# 0006 — The month's requirement is fractional

## Context

The employer states the month un-rounded. The email that prompted this spells the
arithmetic out: 21 working days in the month, 19 once holidays come off, and **13
available** once a six-day incident exclusion does; `13 × 40% = 5.2 days` required —
"further reduced by any leave or training days taken".

The app asked for 6. `computeMonthStats` rounded the month up with `ceil`, and ADR 0001
decision 5 recorded that rounding as deliberate: 8 of 22 days is 36%, so round to 9.
That reasoning holds for a month judged alone, which is what the app did before ADR
0005. It stopped holding once the year became the unit of assessment: with a running
FY balance, a month rounded up bills a whole office day for a fraction the year would
have absorbed, twelve times over.

There was no `training` status either. A training day is excluded from the eligible
base exactly as leave is, but the only way to record one was to stamp it `leave`.

## Decision

The month holds its requirement as **integer percent-points and never rounds**. The
financial year keeps its single `ceil`.

```
requiredPoints   = eligibleDays × targetPercent      // 13 × 40 = 520
requiredDays     = requiredPoints / 100              // 5.2 — for reading only
remainingPoints  = max(0, requiredPoints − officeDays × 100)
```

`requiredPoints` is authoritative and `remainingPoints === 0` is the target-met test.
Points rather than a float because `5.2 - 5` is `0.20000000000000018`: a float
comparison is unreliable at exactly the boundary the test exists to detect. The float
siblings are display values, and `formatDays(points)` renders them.

Also decided: **`training` joins the `day_status` enum**, excluded from the eligible
base exactly as `leave` is. It is computationally identical to leave — the separate
status buys record-keeping, so the record says what the day was. The tap cycle becomes
WFH → office → leave → holiday → training → WFH.

Rejected alternatives:

- **Rounding the month down.** 5 office days out of 13 is 38.5%, below the stated 40%,
  so the month would report met when it is not. The fraction carries to the year
  instead of being forgiven.
- **Reusing `leave` for training days.** Zero migration and identical maths, since both
  leave the eligible base by the same door. But the record then cannot distinguish time
  off from a training day, and the reason for keeping a year of entries is that it says
  what happened.
- **A float requirement instead of points.** Simpler to read in the type, but it puts
  `5.2 - 5 > 0` in the path that decides whether the month is met.

## Consequences

- **The year is stricter than the sum of its months.** A year totalling 19.8 still asks
  for 20, because a fifth of a day cannot be worked. "5.2 required this month" on screen
  and a year demanding a whole extra day coexist by design; the FY line is the
  authoritative one, as ADR 0005 already said.
- ADR 0001 decision 5 is superseded, and is marked so in place rather than rewritten.
- Every month figure moves. A month previously met at its rounded-up requirement is
  still met; a month met at exactly the rounded figure is now met with a surplus.
- `requiredPoints` and `requiredDays` sit side by side in `MonthStats`, which invites
  comparing the wrong one. The comment on `remainingPoints` says which is exact, and no
  caller should compute a verdict from `requiredDays`.
- The FY aggregate got simpler, not harder: `aggregateMonths` already summed
  `eligibleDays × percent` in un-rounded percent-points, so it now sums each month's own
  `requiredPoints` and the two paths cannot drift apart.
- `training` is one additive enum value, so its migration is a single `ALTER TYPE`. No
  existing row changes meaning, and days already stamped `leave` stay leave — there is
  no backfill that could tell which of them were training.

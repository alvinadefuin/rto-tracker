# 0003 — Mandated WFH as day-range exclusions

## Context

Following an incident, management directed everyone to work from home from a
given date until further notice. Those weekdays carry no office obligation and
must not count toward the monthly requirement.

Nothing existing expressed it. Tapping days as `leave` or `holiday` records the
wrong reason, and an open-ended range has no finite set of days to tap. A 0%
`rto_targets` period cannot express a mid-month start.

## Decision

Store mandates as **inclusive day ranges** — `(start_date, end_date)` per user,
`end_date` NULL meaning until further notice — in their own `wfh_mandates`
table, and drop mandated weekdays from the eligible pool exactly as holidays
are dropped.

Rejected alternatives:

- **A 0% target period.** Month granularity cannot split the month the mandate
  began in, and it conflates *what percent applies* with *which days count* —
  the days stay in the eligible pool, so the month reports a misleading achieved
  percentage against days that were never owed. Sharing `rto_targets`' overlap
  check would also forbid a mandate inside a 20% period, which is the real case.
- **A fourth `day_status` enum value.** Reuses the whole day-entry pipeline, but
  "until further notice" has no end, so rows could only be materialised lazily
  as months are visited — a write during a server render. It also cannot hold an
  `office` stamp and a mandate on the same day.

## Consequences

- A partial month prorates for free: a mandate from 12 Aug 2026 leaves 7 of
  August's 21 weekdays eligible, so 3 office days are required instead of 9.
- A mandate beats any recorded status. An `office` stamp inside the window is
  kept as a record and rendered, but excluded from `officeDays`, so
  `officeDays ≤ eligibleDays` holds and `achievedPercent` cannot exceed 100; a
  mandated day also marked leave is likewise counted once, as mandated.
- A weekend-only mandate is permitted — only calendar validity is checked, not
  weekday-ness — so its delete dialog reads "0 working days will count toward
  your requirement again". Harmless and expected, not a bug.
- Dates are `YYYY-MM-DD` text, so all range logic is pure string comparison —
  the same reasoning as month keys in 0002 and day keys throughout.
- Overlaps are rejected at write time; gaps are normal.
- `eligibleDays === 0` now has two causes, so `mandatedDays` is reported to
  distinguish "all leave" from "fully mandated" in the UI copy.
- Deleting a mandate silently returns its days to the eligible pool and can flip
  a met month to unmet, so deletion is confirmed with the affected weekday count.

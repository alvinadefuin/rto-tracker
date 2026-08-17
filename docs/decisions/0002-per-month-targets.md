# 0002 — Per-month RTO targets as closed periods

## Context

The RTO requirement was a hardcoded 40%. The real policy is not constant: it
was reduced to 20% for a period after a fuel price increase, and may change
again. Historical months were being scored against the wrong requirement.

## Decision

Store target changes as **closed periods** — `(start_month, end_month, percent)`
per user, with `end_month` nullable for an ongoing period — and fall back to a
`DEFAULT_RTO_PERCENT` code constant for months no period covers.

Rejected alternatives:

- **Effective-from schedule.** Each row supersedes the previous. Models a
  permanent step change well, but the real case is a *temporary exception* to a
  stable baseline: it would need three rows (40 → 20 → 40) and encode the
  baseline twice.
- **One row per month.** Unambiguous, but an 18-month reduction means 18 rows,
  and every new month needs remembering.

## Consequences

- Gaps are meaningful, not errors — a gap is the default rate.
- Overlaps are rejected at write time, so at most one period covers any month
  and resolution needs no precedence rule.
- Months are `YYYY-MM` text so all range logic is pure string comparison,
  extending the existing dates-are-text invariant.
- Deleting a period silently rescores every month it covered, so deletion is
  confirmed with the affected month count.

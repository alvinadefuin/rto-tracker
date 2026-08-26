# Fractional monthly requirement, and training days

**Date:** 2026-08-26
**Status:** approved, not yet implemented

## Why

An email from the employer spelled out how the monthly RTO requirement is
actually computed, and the arithmetic reproduces exactly against August 2026:

> The original calculation was based on 21 working days. However, due to the
> holidays observed during the month, the total number of working days has been
> adjusted to 19 days. In addition, 6 working days will be excluded due to the
> recent incident, leaving 13 available working days for onsite attendance
> calculations.
>
> Available working days: 13
> Required onsite attendance: 40%
> Computation: 13 × 40% = 5.2 days
>
> Please note that the 5.2-day requirement may be further reduced for approved
> time-off requests (leave) and training days, as these will be excluded from
> the available working days used in the computation.

August 2026 has 21 weekdays; two Philippine holidays fall on weekdays (Fri
21 Aug, Ninoy Aquino Day; Mon 31 Aug, National Heroes Day), giving 19; a six-day
WFH mandate leaves 13. That is `weekdays − holidays − mandated`, which is
already what `computeMonthStats` computes.

So the model is confirmed. The mandate exclusion, the holiday exclusion, and
leave reducing the base are all correct today. Two things diverge.

**The month rounds up and should not.** `computeMonthStats` returns
`Math.ceil((13 × 40) / 100)` = 6 where the employer states 5.2. CLAUDE.md
documents that `ceil` as deliberate, so this reverses a recorded decision
rather than fixing an oversight.

**Training days have no representation.** The enum is `office | leave |
holiday`. Training reduces the available base exactly as leave does.

## Decisions

**The month never rounds; the financial year rounds once.** This is already how
the FY code works — `aggregateMonths` sums `eligibleDays × percent` into
`weightedEligible` un-rounded and `computeFyStats` applies a single `Math.ceil`.
The month becomes consistent with it. August's 0.2 carries into the year instead
of becoming a whole extra office day.

A consequence to state plainly rather than discover later: **the year is
stricter than the sum of its months.** A year totalling 19.8 still asks for 20,
because a fifth of a day cannot be worked. "5.2 required this month" and a year
demanding a whole extra day therefore coexist, by design. `fyVerdict` already
treats the year as the number to act on, and its wording is unchanged — but one
of its branches embeds the **month's** remaining figure, and it reads the float
sibling. Against the pre-change code that was a live defect — `remainingNeeded`
was `requiredDays − officeDays`, and `5.2 − 5` is `0.20000000000000018`. Once
the field is redefined as `remainingPoints / 100` the residue is gone at the
source, so switching the branch to `formatDays(remainingPoints)` with its
singular keyed off `remainingPoints === 100` changes no output. Do it anyway:
it is the rule above ("every comparison is integer") applied to the one place
that still broke it, and the equivalence holds only by accident of how the
field happens to be derived today.

**Training gets its own status** rather than reusing `leave`. The two are
computationally identical — both leave the day out of the eligible base — so the
separate status buys record-keeping and nothing else. That is the point: the
record should say what the day was.

## Design

### Percent-points, not floats

The requirement is held as an **integer count of percent-points**, the same
representation `weightedEligible` already uses, and divided by 100 only at the
display edge:

```ts
const requiredPoints  = eligibleDays * targetPercent;              // 13 × 40 = 520
const remainingPoints = Math.max(0, requiredPoints - officeDays * 100);
```

This is not stylistic. `5.2 - 5` evaluates to `0.20000000000000018` in binary
floating point, so a float requirement makes the "target met" test unreliable at
exactly the boundary it exists to detect.

**Every comparison is integer. `target met` is `remainingPoints === 0`, never
`officeDays >= requiredDays`.**

`MonthStats` gains `requiredPoints` as the source of truth and keeps
`requiredDays`, now the derived exact fraction:

```ts
export interface MonthStats {
  eligibleDays: number;
  officeDays: number;
  requiredPoints: number;   // eligibleDays × targetPercent, integer, un-rounded
  requiredDays: number;     // requiredPoints / 100 — the readable figure, 5.2
  remainingPoints: number;  // integer, exact; 0 means met
  remainingNeeded: number;  // remainingPoints / 100
  targetPercent: number;
  achievedPercent: number;
  mandatedDays: number;
  weeks: WeekStats[];
}
```

The `*Points` field of each pair is authoritative: every comparison and every
rendered string derives from it. The float sibling is kept because it is the
quantity a human means by "how many days do I owe", and because `requiredDays`
is the name the codebase and its 134 tests already use — but nothing in the
rendering path reads it. A future consumer that needs to compare or format one
of these should reach for the points field.

`aggregateMonths` and `computeFyStats` consume `requiredPoints` instead of
recomputing `eligibleDays * targetPercent` inline, so the expression has one
definition. The FY's single `Math.ceil(weighted / 100)` stays exactly as it is.

`achievedPercent` is unchanged — it was always a ratio of whole days.

### Training days

`training` joins the `day_status` pgEnum and is excluded by `isEligible`
alongside `leave`. Four sites enumerate statuses and all four change:

| File | Change |
| --- | --- |
| `src/db/schema.ts:88` | fourth `pgEnum` value |
| `src/app/actions.ts:11` | `STATUSES` validation array |
| `src/components/calendar.tsx:19` | `CYCLE` gains a fifth step |
| `src/lib/rto.ts` | `DayStatus` union; `isEligible` excludes it |

Plus `--color-training` in the `@theme` block of `src/app/globals.css` (there is
no `tailwind.config.*` — tokens live in CSS), and the legend sentence at
`calendar.tsx:274`.

The tap cycle becomes `null → office → leave → holiday → training → null`. Five
steps to return to WFH is the accepted cost of the separate status.

The migration is `ALTER TYPE day_status ADD VALUE 'training'` — purely additive,
so expand-then-contract has nothing to contract and a rollback of the code
leaves a harmless unused enum value behind. Postgres refuses `ADD VALUE` inside
a transaction block, but `neon-http` issues each statement as its own
round-trip with no enclosing transaction, so it applies cleanly. Per CLAUDE.md
the generated SQL is read before applying, and `drizzle/` is committed in the
same commit as `schema.ts`.

### Display

`src/components/stats.tsx` renders the requirement as a row of rings via
`Array.from({ length: requiredDays })`. Left alone this silently truncates 5.2
to **five** rings — a real defect, not a cosmetic one, because the row would
then under-report the requirement.

- Ring count is `Math.ceil(requiredPoints / 100)` — derived from the integer,
  not from the float field, so the count never depends on binary rounding.
- Slot `i` is stamped when `i < officeDays`.
- The final slot is *fractional* when `requiredPoints % 100 !== 0`. Unstamped it
  draws a wedge of `(requiredPoints % 100) / 100` with `conic-gradient`;
  stamped it fills solid like any other slot.

Target card for August 2026 with five days stamped:

```
  ● ● ● ● ● ◔

  5/5.2 stamped · 0.2 to go · 38%

  5.2 office days required — 40% of 13 eligible working days this month
  · 6 days mandated WFH.
```

Both fractional numbers on the card — the requirement and the "to go" figure —
are rendered by one pure formatter in `rto.ts`:

```ts
export function formatDays(points: number): string
```

Called as `formatDays(requiredPoints)` and `formatDays(remainingPoints)`, never
on `requiredDays` or `remainingNeeded`, so no float reaches the screen.
`520 → "5.2"`, `800 → "8"`, `429 → "4.29"`. Trailing zeros trimmed, no rounding — `targetPercent` and `eligibleDays` are both whole, so
points/100 is always exact to two decimals. It lives in `rto.ts` rather than the
component because Vitest runs in a `node` environment, where JSX cannot be
asserted.

The `owedForYear` colour-muting from `8fc54aa` is untouched, as is the
floor-filled FY bar from `b9eedea` — the year stays integer.

## Testing

Test-driven, and the existing suite is the main risk surface. Around a dozen of
the 134 cases in `src/lib/rto.test.ts` assert `requiredDays` as a rounded
integer — `:62`, `:73`, `:270`, `:276`, `:566`, `:574`, `:666` among them. Each
is **rewritten to its exact value**, not deleted: `ceil(8.8) = 9` becomes `8.8`.
A deleted assertion is lost coverage; a rewritten one records the new rule.

New coverage:

- August 2026 end to end — 21 weekdays, 2 holidays, a 6-day mandate, 13
  eligible, `requiredPoints === 520`, `requiredDays === 5.2`.
- `remainingPoints === 0` exactly at the boundary, and the float hazard: 13
  eligible at 40% with 5 office days must report `0.2 to go`, and with 6 must
  report met.
- A month whose requirement is a whole number still reads as one (`"8"`, not
  `"8.0"`), and a two-decimal case (`429 → "4.29"`).
- `isEligible` excludes `training`; a training day reduces `eligibleDays` and is
  not an office day.
- A day that is both mandated and training counts once, matching the existing
  mandated-and-leave case.
- FY roll-up unchanged: three months summing to 19.8 still require 20.

## Out of scope

- **The mandate itself.** `wfh_mandates` already records the six excluded days.
  The email describes a one-off incident and nothing here changes how mandates
  are entered.
- **Automatic holiday import.** Tracked separately in
  `2026-08-22-ph-holiday-import-design.md`; this branch is cut from `main` and
  does not build on it, though both touch eligibility.
- **Loosening the threshold.** 5 office days out of 13 is 38.5%, below the
  stated 40%. The fraction carries to the year rather than being forgiven.

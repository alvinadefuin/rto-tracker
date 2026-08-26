# Philippine Holiday Classification and Month Reference List

**Status:** approved, not yet implemented
**Supersedes parts of:** `2026-08-22-ph-holiday-import-design.md`
**Follows:** `2026-08-26-ph-holiday-import.md` (implemented, commits `a780743`…`40a0cc1`)

## Goal

Two corrections to the shipped holiday import:

1. **Only nationwide non-working holidays should reduce eligible days.** The import currently
   marks every event the feed calls a public holiday, including days that are non-working only
   in BARMM. Maulid un-Nabi (Wed 26 Aug 2026) is the reported case.
2. **The month footnote should list the month's whole holiday calendar**, including holidays
   that fall on a weekend and therefore were never written as rows.

## What is wrong today

`parseHolidayIcs` keeps any event whose `DESCRIPTION` begins `Public holiday`. That is the only
classification the feed offers — verified against the live feed on 2026-08-26: all 311 events
carry `CLASS:PUBLIC`, `STATUS:CONFIRMED` and `TRANSP:TRANSPARENT`, and `DESCRIPTION` takes
exactly two values, `Public holiday` (271) and `Observance` (40). **Nothing in the feed
distinguishes a nationwide regular holiday from a BARMM-only one.** The distinction has to come
from our code.

Separately, `planHolidayImport` drops weekend holidays, and the footnote renders
`day_entries.note`. So a weekend holiday exists nowhere in the app, and November 2026 lists two
holidays when the month has three.

## Decisions

### 1. A name allowlist, not a denylist

`NATIONWIDE_HOLIDAYS` — a `Set` of 27 names in `src/lib/holidays.ts`, checked after stripping a
trailing `(tentative)` suffix.

An allowlist for the same reason the `DESCRIPTION` check is one: **the two directions fail
differently.** An unrecognised name is dropped, which leaves a day eligible and the requirement
*higher* — the user works a day they may not have needed to, and can fix it with a tap. A
denylist that missed a new regional holiday would mark it, silently *lowering* the requirement,
and nothing would ever surface the error. Failing toward more office days is the safe direction.

The consequence is accepted deliberately: **a genuinely new nationwide holiday will be dropped
until someone adds it to the list.** No test can catch that, because the feed is not available
to the unit tests. This is a judgement about labour law, not a user preference, so it lives in
code and travels as a commit.

### 2. Classification of all 35 names in the feed

These are every distinct name the live feed uses across 2021–2031, after stripping `(tentative)`.
Verified: all 27 kept names occur in the feed, so the list contains no typos.

**Keep — regular holidays (RA 9849, nationwide, 12):**
New Year's Day · The Day of Valor · Maundy Thursday · Good Friday · Labor Day ·
Independence Day · National Heroes Day · Bonifacio Day · Christmas Day · Rizal Day ·
Eid al-Fitr · Eid al-Adha

**Keep — special non-working days (nationwide, 11):**
Ninoy Aquino Day · All Saints' Day · All Souls' Day · Feast of the Immaculate Conception ·
Christmas Eve · New Year's Eve · Black Saturday · Lunar New Year's Day ·
Special Day after Christmas · Special non-working day after New Year · National Elections

**Keep — substitute and additional proclaimed days (4):**
Day off for Bonifacio Day · Day off for People Power Anniversary · Ninoy Aquino Day Holiday ·
Lunar New Year Holiday

**Drop — non-working only in BARMM (5):**
Maulid un-Nabi · Lailatul Isra Wal Mi Raj · Amun Jadid · Eid al-Fitr Holiday · Eid al-Adha Holiday

**Drop — special *working* days, or too variable to assume (3):**
Reformation Day · People Power Anniversary · Founding Anniversary of Iglesia ni Cristo

Two classifications deserve their evidence recorded, because they look inconsistent:

- **`X Holiday` is dropped, `Day off for X` is kept.** They are different things, and the feed's
  own dates prove it. Every `Eid al-Adha Holiday` falls the day *after* Eid al-Adha whatever the
  weekday — Tue→Wed 2021, Mon→Tue 2024, Fri→Sat 2025, Mon→Tue 2027 — so it is a second day, not
  a weekend substitute. `Day off for Bonifacio Day` (Mon 27 Nov 2023, for a Thursday Bonifacio
  Day) and `Day off for People Power Anniversary` (Fri 24 Feb 2023, for a Saturday anniversary)
  are the nationwide moved observance. `Ninoy Aquino Day Holiday` (Fri 23 Aug 2024) and
  `Lunar New Year Holiday` (Fri 9 Feb 2024) are the same pattern.
- **`People Power Anniversary` is dropped but `Day off for People Power Anniversary` is kept.**
  The anniversary itself is a special *working* day in most years. 2023 carries both entries,
  which is the tell: when the day is genuinely non-working the feed says `Day off for`.
- **`Reformation Day` is dropped** although it has been declared non-working in some years. It
  flips year to year, and dropping fails toward a higher requirement.

### 3. A reference table, `ph_holidays`

```
ph_holidays
  date  text  PRIMARY KEY   'YYYY-MM-DD'
  name  text  NOT NULL
```

Global, with no `user_id`. Philippine public holidays are the same for everyone and are public
data, so a per-user copy would only duplicate rows. One consequence to accept: a year imported
by one account produces a footnote for the other. That is correct for reference data.

This table is **the PH calendar**; `day_entries` remains **the user's record**. Only
`day_entries` feeds the arithmetic, which is what keeps a tap beating the feed. The reference
table is display-only and nothing computed reads it.

Rejected alternatives:

- **Fetch the feed in `page.tsx`** with a day-long `revalidate`. No migration, and it would work
  for months never imported. Rejected because it puts an external network dependency on the
  app's main view; a slow or unreachable Google degrades `/`, which is currently two database
  queries and pure arithmetic.
- **Store weekend holidays as `day_entries` rows.** No new table, but it breaks the "weekends
  are never stored" invariant, and `setDayStatus` rejects weekends, so such a row could never be
  untapped.

### 4. `day_entries.note` stays, and stays written

The footnote no longer reads it. It is kept because it records **which rows the import wrote** —
provenance a hand-tap does not have, and what any future "undo an import" would need. Dropping
it would need a destructive migration under the expand-then-contract rule, for no gain.

This is recorded honestly: after this change `note` is written and has no reader.

## Behaviour

### `src/lib/holidays.ts`

- `parseHolidayIcs` is **unchanged**. It still returns every `Public holiday` event, so the
  action's "empty parse means the feed format changed" check keeps working on the unfiltered
  result.
- New `isNationwideHoliday(name: string): boolean` — strips a trailing `(tentative)`, trims, and
  tests membership of `NATIONWIDE_HOLIDAYS`. Exported for its own tests.
- `planHolidayImport` filters with it, and `ImportPlan` gains one field:

```ts
export interface ImportPlan {
  toInsert: ImportedHoliday[];   // day_entries rows: nationwide, weekday, in range, clamped, not already present
  reference: ImportedHoliday[];  // ph_holidays rows: nationwide, in range, weekends INCLUDED, not clamped
  alreadyMarked: number;
  beforeRecord: number;
}
```

`reference` is not clamped by `earliestEntry`: it is the calendar, not the user's record, and
`fyWindowStart` reads `day_entries` only, so reference rows cannot move a financial year's start.

Names that fail the allowlist are dropped **without a count**, exactly as weekends and
out-of-range days already are, and for the same reason — they are facts about the feed, not about
the user's record. `formatImportSummary` is unchanged.

### `src/app/holiday-actions.ts`

After the existing `day_entries` insert, replace the year's reference rows:

```
delete from ph_holidays where date between startDate and endDate
insert into ph_holidays values (...plan.reference)
```

Delete-then-insert rather than upsert, so a re-import is authoritative: when a tentative Islamic
date shifts — `Eid al-Fitr (tentative)` moving off 2027-03-10 — the stale row goes rather than
accumulating beside the new one. `neon-http` has no transaction, so a failure between the two
statements leaves that year's reference rows missing. Accepted: the data is display-only and
re-running the import restores it.

`plan.reference` cannot be empty at this point, so the delete cannot wipe a year's rows and
replace them with nothing: `toInsert`, `alreadyMarked` and `beforeRecord` all derive from the same
allowlisted, in-range set that fills `reference`, so an empty `reference` means all three are zero
and the action has already returned its out-of-range error further up. The empty-array guard is
still written, because Drizzle throws on an empty values array and the invariant should not be
load-bearing at a distance.

### `src/app/page.tsx`

A third query in the existing `Promise.all`, selecting `ph_holidays` rows for the displayed month
(`>= ${monthKey}-01`, `<= ${monthKey}-31`). The `monthNotes` map and the `notes` prop are removed.
`<Calendar>` gains `holidays: { date: string; name: string }[]`.

### `src/components/calendar.tsx`

The footnote lists every reference holiday in the month, sorted by date. An entry is annotated
only when that day is **still in the eligible pool** — that is, when the listed holiday is not
actually excluding it. Computed from live `entries`, so a tap updates the annotation immediately.

`isEligible` excludes a day when it is mandated, or its status is `leave` or `holiday`
(`src/lib/rto.ts:329`). So only two states leave a listed holiday counting against the user:

| Condition | Annotation | Why |
|---|---|---|
| weekend | `(Sat)` / `(Sun)` | never counted; shown so the month's list is complete |
| mandated, or status `holiday` or `leave` | none | already out of the eligible pool |
| status `office` | `(you marked office)` | still eligible — the holiday is not applying |
| no row (work from home) | `(not marked)` | still eligible — the holiday is not applying |

Annotating `leave` or a mandated day would be wrong: it would imply the day counts, when it does
not. This is why the rule is phrased as "is this day still eligible", not "did the user override
the holiday".

```
HOLIDAYS
21  Ninoy Aquino Day
24  Christmas Eve
25  Christmas Day      (you marked office)
30  Rizal Day
31  New Year's Eve
```

Holidays marked by hand do not appear — the heading lists the PH calendar, not the user's record.

## Rollout

- **Existing rows are not retracted.** Maulid un-Nabi (2026-08-26) and the other two FY2027
  regional days stay in `day_entries` until tapped off. The import must not delete rows: it
  cannot tell a row it wrote from one the user set by hand.
- **The footnote is empty until each year is re-imported**, because `ph_holidays` starts empty.
  Re-importing is one click per year and is safe.

## Testing

Unit tests in `src/lib/holidays.test.ts`:

- `isNationwideHoliday` over a table of all 35 real feed names, asserting the 27/8 split.
- The `(tentative)` suffix is stripped before matching.
- An unknown name returns false.
- `planHolidayImport` populates `reference` with weekend holidays that `toInsert` omits.
- `reference` ignores `earliestEntry` while `toInsert` still honours it.
- `reference` still respects the date range and the allowlist.

Existing tests that must keep passing unchanged: the whole `parseHolidayIcs` suite, the clamp
tests, and `formatImportSummary`.

Verified numbers for FY2027 (Aug 2026 – Jul 2027), to assert against:

| | before | after |
|---|---|---|
| weekday holidays | 18 | **15** |
| eligible days (260 weekdays) | 242 | 245 |
| required at 40% | 97 | **98** |

The three removed are Maulid un-Nabi (Wed 26 Aug 2026), Lailatul Isra Wal Mi Raj (Wed 6 Jan 2027)
and Eid al-Adha Holiday (Tue 18 May 2027).

## Out of scope

- Retracting already-imported regional holidays.
- Any country but PH; a per-user country or allowlist setting.
- Distinguishing regular holidays from special non-working days in the UI — both leave the
  eligible pool identically.
- An employment start date, still the largest known gap (see the prior spec).

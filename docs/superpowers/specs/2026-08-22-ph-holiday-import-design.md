# Philippine holiday import — design

Date: 2026-08-22
Branch: `feat/ph-holiday-import`
Status: in review

## Problem

Public holidays leave the eligible pool, so every one of them lowers the month's
requirement — and, through `weightedEligible`, the financial year's. Today the only way
to record one is to tap the day, which means knowing the date in the first place.

The Philippines has **18 weekday public holidays in FY2027** (Aug 2026 – Jul 2027).
Against 260 weekdays at 40%, marking them is the difference between owing **104 office
days and 97** — seven days of the year, for a year's worth of remembering. Miss one in
December and the month's `requiredDays` is one too high, and the error persists in the
FY baseline for the rest of the year.

The dates are also not guessable. Ten of the eighteen are fixed (Christmas, Rizal Day,
Bonifacio Day); the other eight move — Maundy Thursday and Good Friday follow Easter,
and five Islamic holidays follow the lunar calendar and are proclaimed only months
ahead:

```
2026-08-21 Fri  Ninoy Aquino Day            2027-01-01 Fri  New Year's Day
2026-08-26 Wed  Maulid un-Nabi              2027-01-06 Wed  Lailatul Isra Wal Mi Raj (tentative)
2026-08-31 Mon  National Heroes Day         2027-03-10 Wed  Eid al-Fitr (tentative)
2026-11-02 Mon  All Souls' Day              2027-03-25 Thu  Maundy Thursday
2026-11-30 Mon  Bonifacio Day               2027-03-26 Fri  Good Friday
2026-12-08 Tue  Immaculate Conception       2027-04-09 Fri  The Day of Valor
2026-12-24 Thu  Christmas Eve               2027-05-17 Mon  Eid al-Adha (tentative)
2026-12-25 Fri  Christmas Day               2027-05-18 Tue  Eid al-Adha Holiday (tentative)
2026-12-30 Wed  Rizal Day
2026-12-31 Thu  New Year's Eve
```

FY2026 is 21 weekday holidays and 9 office days for comparison — the count varies with
how many fall on weekends, which is why it cannot be approximated.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Source | Google's public `en.philippines` holiday ICS | 28 entries for 2026 against Nager.Date's 18. Nager omits Eid al-Fitr, Eid al-Adha, Maulid un-Nabi and All Souls' Day — five weekday holidays in 2026 alone — and cannot separate observances from holidays |
| Storage | Ordinary `holiday` rows in `day_entries` | `isEligible`, `computeMonthStats`, `aggregateMonths` and the calendar already handle `holiday`. An overlay table would need a fourth exclusion source threaded through all of them |
| Precedence vs your taps | Your tap always wins | A proclamation can be revoked, or the office opens anyway. An overlay would inherit the mandate's rule — mandate beats tap — and then an office day worked on a mis-proclaimed holiday could never be counted |
| Existing rows | Never overwritten | Makes re-running the import safe and non-destructive. A day you marked `office` or `leave` stays as it is |
| Names | New nullable `day_entries.note` | The chosen storage has nowhere to put a name, and a ~47px mobile cell has nowhere to show one. Both problems are solved by storing the name and rendering it as a month footnote |
| Trigger | Explicit button in Settings, one financial year at a time | Bounded, so it cannot reach into months you were not employed. Explicit, so what got written is reported back rather than inferred |
| Earliest writable date | Never before your earliest existing entry | The import cannot move `trackingStart`, so it cannot change which months an FY counts from. See below — this is the load-bearing rule |
| Observances | Dropped | People Power Anniversary, Ramadan Start and Easter Sunday are working days |
| Weekend holidays | Dropped | `setDayStatus` rejects weekends, weekends are never stored, and no arithmetic looks at them |
| Tentative dates | Imported, `(tentative)` kept in the name | They are real proclamations with moon-dependent dates. The suffix is information; re-tap if one shifts |
| Country | Hardcoded to PH | Same reasoning as `FY_START_MONTH = 8`: one employer, one calendar |

### Why the earliest-date clamp is load-bearing

`fyWindowStart` derives the start of an FY window from the earliest row in `day_entries`
(`page.tsx:83`), so that an FY predating the app reports nothing rather than a
hundred-day deficit. Imported holidays *are* `day_entries` rows, so an unclamped import
would redefine that boundary as a side effect.

Concretely, with a record starting 11 Feb 2026: importing FY2026 (Aug 2025 – Jul 2026)
would write Ninoy Aquino Day 2025 and move `trackingStart` from Feb 2026 back to
Aug 2025. FY2026 would then bill all twelve months, and the app would report a
five-month deficit against months of unemployment.

Clamping to `min(day_entries.date)` makes that impossible by construction rather than by
remembering. It also means importing FY2026 does the right thing unprompted: holidays
from 11 Feb 2026 onward are written, Aug 2025 – 10 Feb 2026 is skipped and reported as
skipped.

When the user has no entries at all there is nothing to clamp to, and the import defines
the start — importing FY2027 first sets `trackingStart` to Aug 2026, which is correct for
that FY.

## Data model

One additive column in `src/db/schema.ts`:

```ts
export const dayEntries = pgTable(
  "day_entries",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD; text avoids TZ drift
    status: dayStatusEnum("status").notNull(),
    note: text("note"), // optional human note; never parsed
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })]
);
```

`note` mirrors `wfhMandates.reason` deliberately, comment included: a nullable display
string that no logic reads. Nothing branches on it, nothing validates it beyond a length
cap, and no arithmetic sees it.

Purely additive, so the expand-then-contract rule is satisfied without a second deploy:
the previous deployment keeps serving through the migration and never selects the column.

## Notes and the status cycle

`setDayStatus` needs **no change**. Its upsert already sets only the status:

```ts
.onConflictDoUpdate({
  target: [dayEntries.userId, dayEntries.date],
  set: { status },       // note untouched
})
```

So a note survives a status change and dies with the row on delete. Cycling 25 Dec
holiday → office → leave → holiday keeps "Christmas Day" attached throughout; cycling it
to WFH deletes the row and the name with it. Re-importing then restores both.

The footnote list requires `status === "holiday"`, so a note sitting on an office day is
dormant rather than wrong — it does not appear under a heading that says Holidays.

## Pure logic — `src/lib/holidays.ts`

A new module, not an addition to `rto.ts`: that file is the requirement arithmetic, and
this is a parser. Nothing here touches a clock or constructs a `Date` from a string.

```ts
export interface ImportedHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

export function parseHolidayIcs(ics: string): ImportedHoliday[];
```

Steps, in order:

1. **Normalise line endings** — `\r\n` → `\n`.
2. **Unfold** — RFC 5545 folds long lines with a line break plus one space *or* one tab,
   so `/\n[ \t]/g` → `""`. Both forms, and normalising first means one pass covers CRLF
   and LF feeds alike. Unfolding must precede everything: `SUMMARY` values wrap.
3. **Split on `BEGIN:VEVENT` … `END:VEVENT`.**
4. **Date** — `DTSTART;VALUE=DATE:YYYYMMDD` sliced into `YYYY-MM-DD` by index. Never
   `new Date("...")`, per the codebase's central invariant. An event with no
   date-valued `DTSTART` is dropped.
5. **Category allowlist** — keep only events whose `DESCRIPTION` starts with
   `Public holiday`; drop everything else, including events with no `DESCRIPTION`.
6. **Name** — `SUMMARY`, with the ICS escapes `\,` `\;` `\\` and `\n` unescaped.

The allowlist is checked against the live feed: all 311 events carry a `DESCRIPTION`, and
exactly two values occur — `Public holiday` (271) and `Observance` (40). An allowlist
rather than a denylist on `Observance` because the failure directions differ. If Google
changes the field, a denylist marks Easter Sunday and the People Power Anniversary as
holidays and quietly lowers your requirement; an allowlist yields zero events, which the
action reports as a format failure. The residual risk is that a *new* third category
would be silently dropped — recoverable by tapping, unlike a wrong exclusion.

`(tentative)` is left in the name. It is the feed's own hedge and belongs in front of the
user, not stripped in a parser.

Weekend and range filtering are **not** in this module. Weekends are `isWeekend` from
`rto.ts`, and the range is a pure string comparison at the call site — neither earns a
wrapper.

## Server action — `src/app/holiday-actions.ts`

```ts
export async function importHolidays(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState>;
```

New module rather than an addition to `settings-actions.ts` or `mandate-actions.ts`:
those own `rto_targets` and `wfh_mandates` respectively, and this writes `day_entries`.

Sequence:

1. `requireUserId()`.
2. Parse `fy` as an integer. Reject anything outside 2000–2100 — a sanity bound on the
   input, not a claim about feed coverage.
3. `financialYearBounds(fy)` → `YYYY-MM` bounds → day bounds `${startMonth}-01` and
   `${endMonth}-31`. The `-31` upper bound is the existing fixed-width-key trick: July
   has 31 days anyway, and no stored day can fall past a short month's end.
4. Read `min(dayEntries.date)` and the existing dates in range, in one `Promise.all`
   — neon-http opens an HTTPS request per query with no pipelining, so the two go
   together.
5. `fetch` the ICS with `cache: "no-store"` and `signal: AbortSignal.timeout(10_000)`.
   Non-2xx or a throw → feed-unreachable error.
6. `parseHolidayIcs`. **Zero events overall → format-change error**, not a successful
   import of nothing. This is the guard that stops a silently changed feed from reading
   as "no holidays this year".
7. Filter in four steps: drop days outside the FY range, drop weekends, drop days
   earlier than the earliest existing entry, drop days that already have a row. Only the
   last two are counted — those two are facts about the user's record and belong in the
   summary. Range and weekend rejections are not reported: they are properties of the
   feed and the calendar, and a line reading `18 marked · 10 weekends skipped` invites
   the reader to wonder what went wrong.
8. Insert. `values([...]).onConflictDoNothing()` — one statement, so atomic even without
   a neon-http transaction, and the conflict clause covers the race between step 4 and
   here. **Guarded on a non-empty array**, since Drizzle throws on `values([])`.
9. `revalidatePath("/")` and `revalidatePath("/settings")`.
10. Return a notice.

### Failure messages

Three cases, deliberately distinguishable — the difference between them is the
difference between "retry" and "the feature is broken":

| Case | Message |
|---|---|
| fetch failed, timed out, or non-2xx | `Couldn't reach the holiday feed. Try again.` |
| parsed zero events from a non-empty body | `The holiday feed format has changed — no holidays could be read.` |
| events parsed, none inside the FY | `The feed has no holidays for FY2027 (Aug 2026 – Jul 2027).` |

No hardcoded coverage window. The feed currently spans 2021–2031 and Google rolls it
forward, so a constant would rot; case three discovers the edge instead.

### `ActionState`

Widened to carry a success summary:

```ts
export type ActionState = { error?: string; notice?: string } | null;
```

Backward compatible — the four existing forms read only `error`. But note that
`MandateForm` and `PeriodForm` detect success as a `pending` true→false edge landing
without an error, on the stated assumption that a successful action leaves `state` null.
That assumption does not hold for `importHolidays`, which returns a notice on success.
The import therefore gets **its own form component** and must not be wired through that
pattern.

## Settings UI

A third block below Mandates, following the established shape — a `border-t border-rule
pt-6` heading with prose, then a bordered panel:

```
────────────────────────────────────────
PHILIPPINE HOLIDAYS

Fetches the Philippine public holiday list and marks those
weekdays as holidays, which removes them from your eligible
days. Days you have already marked are left alone, and nothing
is written before your record starts.

┌──────────────────────────────────────┐
│ FINANCIAL YEAR                       │
│ [ FY2027 (Aug 2026 – Jul 2027)  ▾ ]  │
│ [ Import holidays ]                  │
│                                      │
│ 12 marked · 3 already marked · 5     │
│ before your record starts            │
└──────────────────────────────────────┘
```

`<ImportHolidaysForm>`, a client component using `useActionState`, with the disabled
`pending` button and `role="alert"` error styling copied from `MandateForm`.

The select offers the current FY plus the four before and one after, labelled
`FY2027 (Aug 2026 – Jul 2027)` so the Aug–Jul span is never ambiguous. Its default
reads the server clock, which within a day of 1 August can preselect the neighbouring
FY. That is accepted: it is a dropdown default the user can change, not computed output,
and unlike `currentMonthKey()` it feeds no arithmetic.

The summary omits zero-valued clauses — `12 marked` alone, not `12 marked · 0 already
marked · 0 before your record starts`. A run that writes nothing reads
`No new holidays to mark.`

## Calendar UI

`page.tsx` selects `note` alongside `date` and `status`, and passes a `notes` map for the
displayed month only — the same narrowing `monthEntries` already does, for the same
reason. The window-wide rows keep their notes server-side, where `aggregateMonths`
ignores them.

```tsx
<Calendar
  key={monthKey}
  monthKey={monthKey}
  initialEntries={monthEntries}
  notes={monthNotes}          // Record<string, string>, every note in the month
  targetPercent={targetPercent}
  mandates={monthMandates}
  fyBaseline={fyBaseline}
/>
```

`notes` is a separate prop rather than a richer `Entries`. `Entries` is
`Record<string, DayStatus>` throughout `rto.ts` and every arithmetic function takes it;
widening it would touch all of them to carry a string none of them read.

It carries **every** note in the month, not only those on `holiday` rows. The status
filter has to happen in the client, against live state, because a note outlives a status
change: a day cycled holiday → office still has its name in the database, and cycling it
back to holiday must show that name again on the same tap. Filtering server-side by
status would leave the footnote blank until a reload.

The footnote renders below the grid and above the existing hint paragraph, in the
`border-l-2 border-fade pl-3` idiom the mandate banner already uses:

```tsx
const namedHolidays = Object.entries(notes)
  .filter(([date]) => entries[date] === "holiday")
  .sort(([a], [b]) => a.localeCompare(b));
```

```
┌──────┬──────┬──────┬──────┬──────┬────┐
│ 17   │ 18   │ 19   │ 20   │ 21   │    │
│      │      │      │      │HOLI- │4/4 │
│      │      │      │      │DAY   │    │
└──────┴──────┴──────┴──────┴──────┴────┘

│ HOLIDAYS
│ 21  Ninoy Aquino Day
│ 26  Maulid un-Nabi
│ 31  National Heroes Day
```

Derived from local `entries`, not from props alone, so cycling a day off `holiday` drops
it from the list on the same tap that changes the cell. Hidden entirely when the list is
empty. Day numbers get a fixed-width `tabular-nums` column so the names align.

Identical on mobile and desktop, which is the point: a ~47px cell has room for neither a
name nor a tooltip, and `HOLIDAY` at `text-[10px] tracking-widest` already fills it.

Holidays you marked by hand carry no note and so do not appear. The heading is a list of
named holidays, not a claim to be every holiday in the month.

## Testing — `src/lib/holidays.test.ts`

`holidays.ts` joins `rto.ts` as unit-tested pure logic. The action stays untested,
matching the existing convention. Inline ICS strings rather than a fixture file — each
case asserts one property and states it in the string.

| Case | Asserts |
|---|---|
| `DTSTART;VALUE=DATE:20261225` | → `2026-12-25`, sliced not parsed |
| `SUMMARY` folded across two lines with `\n ` | unfolded to one name |
| same folded with `\n\t` | tab folding handled |
| CRLF-delimited input | normalisation precedes unfolding |
| `DESCRIPTION:Observance` | dropped |
| `DESCRIPTION:Public holiday\nDate is tentative…` | kept, `(tentative)` retained in the name |
| event with no `DESCRIPTION` | dropped — allowlist, not denylist |
| `SUMMARY:Rizal Day\, Manila` | `\,` unescaped to `,` |
| `DTSTART` with a datetime, not a date | dropped |
| empty string, and a body with no `VEVENT` | `[]` — the signal the action turns into a format error |
| two events | both returned, feed order preserved |

Range, weekend and clamp filtering live in the action and are covered by existing
`isWeekend` tests plus the string comparisons themselves.

## Documentation

- `CLAUDE.md` — the holiday import under Architecture: that imported holidays are
  ordinary `day_entries` rows, that a tap beats the feed, that `note` is display-only,
  and the earliest-date clamp with its reason.
- `docs/architecture.md` — the import in the data flow.
- No ADR. This adds no rule that constrains later work the way the FY or migration
  decisions do; the one durable invariant is the clamp, which belongs in `CLAUDE.md`
  beside `fyWindowStart`.

## Rollout

1. `npm run db:generate`, **read** the emitted SQL — it must be one `ALTER TABLE
   day_entries ADD COLUMN "note" text;` and nothing else — then `npm run db:migrate` and
   commit `drizzle/` in the same commit as the `schema.ts` edit.
2. `holidays.ts` with its tests, before anything that calls it.
3. The action, then the Settings form, then the calendar footnote.
4. `make test` and `make lint`.
5. Verify against the dev branch by importing FY2027 and checking August 2026 shows
   Ninoy Aquino Day, Maulid un-Nabi and National Heroes Day, and that FY2027's
   requirement drops.

Additive migration, so no rollback hazard: reverting the code leaves an unread column.

## Out of scope

- **Employment start date.** The clamp handles the Feb 2026 window boundary, but Feb
  2026's own eligible days still include 2–10 Feb, before the user joined. That
  over-counts February and FY2026, and it is the next spec's problem.
- **Clearing a month's marks.** Also the next spec.
- **Any country but PH**, and any per-user country setting.
- **Automatic or scheduled import.** Writing rows during a server-component render is
  the reason; a GET that mutates would also race concurrent renders.
- **Distinguishing regular holidays from special non-working days.** The feed does not
  carry it, and both come out of the eligible pool identically.
- **Recording which FYs have been imported.** The summary line covers it, and a re-run
  is safe.

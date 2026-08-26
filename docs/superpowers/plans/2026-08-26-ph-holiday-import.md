# Philippine Holiday Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Philippine public holidays from Google's public ICS feed and mark them as `holiday` days for one financial year at a time, without ever overwriting a day the user marked or writing a day earlier than their record begins.

**Architecture:** Imported holidays are ordinary `day_entries` rows with `status = 'holiday'`, so no arithmetic changes at all — `isEligible`, `computeMonthStats`, `aggregateMonths` and `computeFyStats` already handle them, and a tap still beats the feed because a tap rewrites the row. One additive column, `day_entries.note`, carries the holiday's name for display. All the decision-making is pure and unit-tested in a new `src/lib/holidays.ts`: parsing the ICS, and planning which days to write. The server action is a thin shell — two queries, a fetch, two pure calls, one insert.

**Tech Stack:** Next.js 16.3 (App Router), React 19, Drizzle ORM 0.45, Neon Postgres, Auth.js v5, Tailwind v4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-22-ph-holiday-import-design.md`

---

## Before you start

Read `CLAUDE.md` and `AGENTS.md` in the repo root. Six invariants govern the tasks below:

1. **Dates are text, never `Date`.** Day keys are `YYYY-MM-DD`, month keys are `YYYY-MM`. Both are zero-padded and fixed-width, so `<=` and `>=` on the strings are correct calendar comparisons. Never write `new Date("2026-12-25")` — that parses through the local timezone and can shift the day. `new Date(Date.UTC(y, m - 1, d))` built from split integers is fine. **In this feature the ICS date is built by slicing eight digits by index. No `Date` is constructed for it at all.**
2. **`src/lib/rto.ts` is pure and isomorphic.** Server (`page.tsx`) and client (`calendar.tsx`) both import it. It must not touch the database, the network, or the clock. The new `src/lib/holidays.ts` inherits the same rule.
3. **Absence of a row on a weekday means WFH.** There is no `wfh` status. The enum is `office | leave | holiday`. Weekends are never stored, and `setDayStatus` rejects them.
4. **A tap must beat the feed.** This is why holidays are `day_entries` rows and not a third exclusion overlay like `wfh_mandates`. A mandate deliberately beats a tap; a holiday must not, because a proclamation can be revoked or the office opens anyway.
5. **The import must never move `trackingStart`.** `fyWindowStart` derives the start of a financial-year window from `min(day_entries.date)` (`src/app/page.tsx:83`). Imported holidays *are* `day_entries` rows. An import that wrote a day earlier than the user's first real entry would silently redefine which months a financial year bills. Task 3 is where this is enforced and tested; do not move that check into the action.
6. **Schema changes travel as committed migrations.** If you edit `src/db/schema.ts` you must run `npm run db:generate`, read the emitted SQL, run `npm run db:migrate`, and commit `drizzle/` in the same commit. A schema edit without its migration compiles, deploys green, and then 500s on the first query touching the new column.

Confirm a green baseline before touching anything:

```bash
npm test
```

Expected: `Test Files  3 passed (3)`, `Tests  179 passed (179)`.

Only Task 1 touches `src/db/schema.ts`. If you find yourself editing it in any other task, stop — you have gone off-plan.

### Feed facts asserted below

These were verified against the live feed on 2026-08-26. Do not "correct" them.

| Fact | Value |
|---|---|
| Feed URL | `https://calendar.google.com/calendar/ical/en.philippines%23holiday%40group.v.calendar.google.com/public/basic.ics` |
| Total events | 311, spanning 2021–2031 |
| Distinct `DESCRIPTION` values | exactly two: `Public holiday` (271) and `Observance` (40) |
| Every event has a `DESCRIPTION` | yes — 0 without |
| Weekday public holidays in FY2027 (Aug 2026 – Jul 2027) | 18 |
| FY2027 weekdays | 260, so `ceil(260 × 40 / 100) = 104` office days with no holidays marked |
| FY2027 with all 18 marked | 242 eligible, `ceil(242 × 40 / 100) = 97` — the import is worth **7 office days** |

The 18 weekday holidays in FY2027, used as fixtures below:

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

---

## File Structure

**Create:**
- `src/lib/holidays.ts` — ICS parsing and import planning. Pure, no network, no clock, no database. Separate from `rto.ts` because that file is the requirement arithmetic and this is a parser plus a filter.
- `src/lib/holidays.test.ts` — unit tests for the above.
- `src/lib/clock.ts` — the app's single `new Date()` read, isolated so its timezone caveat has one home. Extracted from `page.tsx`, which today keeps it private while the settings page needs the same value.
- `src/app/holiday-actions.ts` — the `importHolidays` server action. Its own module because `settings-actions.ts` owns `rto_targets` and `mandate-actions.ts` owns `wfh_mandates`; this writes `day_entries`.
- `src/components/import-holidays-form.tsx` — client form. Cannot reuse `MandateForm`'s success detection; see Task 5.

**Modify:**
- `src/db/schema.ts` — add `note` to `dayEntries`.
- `drizzle/` — the generated migration (Task 1).
- `src/lib/action-state.ts` — widen `ActionState` with an optional `notice`.
- `src/lib/rto.ts` — add `formatFinancialYear`.
- `src/lib/rto.test.ts` — tests for it.
- `src/app/page.tsx` — select `note`, build `monthNotes`, pass it to `Calendar`, use `src/lib/clock.ts`.
- `src/app/settings/page.tsx` — the holiday-import section.
- `src/components/calendar.tsx` — accept `notes`, render the month footnote.
- `CLAUDE.md`, `docs/architecture.md`.

**Not touched:** `src/app/actions.ts`, `src/lib/rto.ts`'s arithmetic (only a formatter is added), `src/components/stats.tsx`, `src/components/mandate-form.tsx`, `src/components/period-form.tsx`, `src/auth.ts`, `src/db/index.ts`.

### Three deviations from the spec

Each is a deliberate improvement, not a drift. Do not "restore" the spec's version.

1. **The filtering logic is extracted into a tested pure function**, `planHolidayImport`, rather than living inline in the action as the spec described. The earliest-date clamp is the one durable invariant this feature adds, and Vitest cannot reach a server action that needs a database. This mirrors commit `f41feb5`, which extracted the FY window-start rule into `fyWindowStart` for exactly this reason.
2. **`formatImportSummary` has no "nothing to do" special case.** The spec called for `No new holidays to mark.` when a run writes nothing. But the action returns a range error when *nothing at all* landed in range, so that branch would be unreachable from its only caller. A completed year instead reads `0 marked · 18 already marked`, which says more.
3. **`formatFinancialYear` is added to `rto.ts`** rather than the label being built in the settings page. Both the select's option labels and the action's range error need the same string, and `rto.ts` already owns the tested display formatters (`formatMonth`, `formatPeriodRange`, `formatMandateRange`).

---

## Task 1: the `note` column

**Files:**
- Modify: `src/db/schema.ts:94-104` (the `dayEntries` table)
- Create: `drizzle/0001_<generated_name>.sql` (drizzle-kit picks the name)
- Modify: `drizzle/meta/_journal.json`, `drizzle/meta/0001_snapshot.json` (both generated)

No test. This is a schema change with no logic; the column is exercised end-to-end in Task 8.

- [ ] **Step 1: Add the column**

In `src/db/schema.ts`, the `dayEntries` table becomes:

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

The comment is copied verbatim from `wfhMandates.reason` on purpose: it is the same kind of column — a nullable display string that no logic reads and nothing branches on.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

Expected: a new file `drizzle/0001_<something>.sql`.

- [ ] **Step 3: Read the generated SQL**

Run: `cat drizzle/0001_*.sql`

Expected — this exact statement and nothing else:

```sql
ALTER TABLE "day_entries" ADD COLUMN "note" text;
```

**If you see a `DROP`, a `CREATE TABLE`, or any statement touching another table, stop and report it.** `drizzle-kit generate` cannot tell a rename from a drop-plus-add, and this migration must be purely additive — that is what lets it deploy without an expand-then-contract pair, because the previous deployment keeps serving through the migration and never selects the column.

- [ ] **Step 4: Apply it to the dev branch**

Run: `npm run db:migrate`

Expected: completes with no error. This targets the Neon **dev** branch — `DATABASE_URL` in `.env.local`. There is no production connection string on this machine.

- [ ] **Step 5: Confirm nothing else drifted**

Run: `npm run db:check && npm test`

Expected: the journal validates, and `Test Files  3 passed (3)`, `Tests  179 passed (179)`.

- [ ] **Step 6: Commit**

The schema edit and its migration must land together — a schema edit without its migration ships nothing.

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: nullable note column on day entries"
```

---

## Task 2: `parseHolidayIcs`

**Files:**
- Create: `src/lib/holidays.ts`
- Create: `src/lib/holidays.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/holidays.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseHolidayIcs } from "./holidays";

/**
 * Minimal well-formed event. Every case below is this shape with one thing
 * changed, so a failure names the property it broke.
 */
function event(lines: string): string {
  return `BEGIN:VCALENDAR\nBEGIN:VEVENT\n${lines}\nEND:VEVENT\nEND:VCALENDAR`;
}

describe("parseHolidayIcs", () => {
  it("slices a date-valued DTSTART into YYYY-MM-DD", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261225\nSUMMARY:Christmas Day\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)).toEqual([
      { date: "2026-12-25", name: "Christmas Day" },
    ]);
  });

  it("unfolds a SUMMARY folded with a space", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261208\nSUMMARY:Feast of the Immaculate\n Conception\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)[0].name).toBe(
      "Feast of the Immaculate Conception"
    );
  });

  it("unfolds a SUMMARY folded with a tab", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261208\nSUMMARY:Feast of the Immaculate\n\tConception\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)[0].name).toBe(
      "Feast of the Immaculate Conception"
    );
  });

  it("normalises CRLF before unfolding", () => {
    const ics =
      "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261208\r\nSUMMARY:Feast of the Immaculate\r\n Conception\r\nDESCRIPTION:Public holiday\r\nEND:VEVENT";
    expect(parseHolidayIcs(ics)).toEqual([
      { date: "2026-12-08", name: "Feast of the Immaculate Conception" },
    ]);
  });

  it("drops observances", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20270225\nSUMMARY:People Power Anniversary\nDESCRIPTION:Observance"
    );
    expect(parseHolidayIcs(ics)).toEqual([]);
  });

  it("keeps a tentative holiday, suffix and all", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20270310\nSUMMARY:Eid al-Fitr (tentative)\nDESCRIPTION:Public holiday\\nDate is tentative and may vary"
    );
    expect(parseHolidayIcs(ics)).toEqual([
      { date: "2027-03-10", name: "Eid al-Fitr (tentative)" },
    ]);
  });

  // An allowlist, not a denylist on "Observance". If the feed drops or renames
  // DESCRIPTION, an allowlist yields nothing and the action reports a format
  // failure; a denylist would mark Easter Sunday a holiday and quietly lower
  // the requirement.
  it("drops an event with no DESCRIPTION", () => {
    const ics = event("DTSTART;VALUE=DATE:20261225\nSUMMARY:Christmas Day");
    expect(parseHolidayIcs(ics)).toEqual([]);
  });

  it("drops an event whose DESCRIPTION is neither category", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261225\nSUMMARY:Christmas Day\nDESCRIPTION:Season"
    );
    expect(parseHolidayIcs(ics)).toEqual([]);
  });

  it("unescapes escaped commas, semicolons and backslashes", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261230\nSUMMARY:Rizal Day\\, Manila\\; observed \\\\ nationwide\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)[0].name).toBe(
      "Rizal Day, Manila; observed \\ nationwide"
    );
  });

  it("collapses an escaped newline in a name to a space", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261102\nSUMMARY:All Souls'\\nDay\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)[0].name).toBe("All Souls' Day");
  });

  it("drops a datetime DTSTART — an all-day holiday is a date", () => {
    const ics = event(
      "DTSTART:20261225T000000Z\nSUMMARY:Christmas Day\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)).toEqual([]);
  });

  it("returns [] for an empty string", () => {
    expect(parseHolidayIcs("")).toEqual([]);
  });

  it("returns [] for a body with no VEVENT", () => {
    expect(parseHolidayIcs("BEGIN:VCALENDAR\nEND:VCALENDAR")).toEqual([]);
  });

  it("returns every event, in feed order", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261231",
      "SUMMARY:New Year's Eve",
      "DESCRIPTION:Public holiday",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260821",
      "SUMMARY:Ninoy Aquino Day",
      "DESCRIPTION:Public holiday",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    expect(parseHolidayIcs(ics)).toEqual([
      { date: "2026-12-31", name: "New Year's Eve" },
      { date: "2026-08-21", name: "Ninoy Aquino Day" },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: FAIL — `Failed to resolve import "./holidays"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/holidays.ts`:

```ts
/**
 * A public holiday as the feed reports it.
 *
 * `name` is display copy only — nothing in the app parses it, and no
 * arithmetic sees it. It lands in `day_entries.note`.
 */
export interface ImportedHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

/**
 * ICS text escapes, per RFC 5545 §3.3.11: `\,` `\;` `\\` and `\n`.
 *
 * One pass rather than chained `replace` calls, because chaining gets `\\n`
 * wrong — the first pass would turn an escaped backslash followed by an `n`
 * into a newline. An escaped newline becomes a space: the footnote that renders
 * these names is one line per holiday.
 */
function unescapeIcsText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    const escaped = value[++i];
    if (escaped === undefined) out += "\\"; // trailing backslash, kept as-is
    else if (escaped === "n" || escaped === "N") out += " ";
    else out += escaped; // \, \; \\ and anything else: the character itself
  }
  return out;
}

/** Value of an unfolded `NAME:value` line within one event, or null. */
function field(body: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\n)${name}:(.*)`).exec(body);
  return match ? match[1].trim() : null;
}

/**
 * Public holidays in an ICS feed, in feed order.
 *
 * Returns `[]` rather than throwing on anything it cannot read. An empty result
 * from a feed that answered is the caller's signal that the format changed —
 * see `importHolidays`, which reports that as a failure rather than as a year
 * without holidays.
 */
export function parseHolidayIcs(ics: string): ImportedHoliday[] {
  // Normalise line endings, then unfold. RFC 5545 folds long lines with a line
  // break plus one space or one tab; normalising first means a single pass
  // covers CRLF and LF feeds alike. This must precede everything else —
  // SUMMARY values wrap, and a folded name would otherwise be truncated.
  const unfolded = ics.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");

  const holidays: ImportedHoliday[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];

    // Allowlist, not a denylist on "Observance". The live feed carries a
    // DESCRIPTION on all 311 events and exactly two values occur —
    // "Public holiday" (271) and "Observance" (40) — so this is checked, not
    // guessed. The two directions fail differently: were the field renamed, an
    // allowlist marks nothing and the caller says so, where a denylist would
    // mark Easter Sunday and the People Power Anniversary as holidays and
    // silently lower the requirement. A new third category would be dropped,
    // which the user can fix with a tap.
    const description = field(body, "DESCRIPTION");
    if (description === null || !description.startsWith("Public holiday")) {
      continue;
    }

    // Date-valued DTSTART only. The eight digits are sliced by index and never
    // parsed — the codebase's central invariant. A datetime DTSTART is not an
    // all-day holiday, and the trailing anchor is what rejects one.
    const digits = /(?:^|\n)DTSTART;VALUE=DATE:(\d{8})(?=\n|$)/.exec(body)?.[1];
    if (digits === undefined) continue;

    const summary = field(body, "SUMMARY");
    if (summary === null) continue;

    holidays.push({
      date: `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`,
      name: unescapeIcsText(summary).trim(),
    });
  }
  return holidays;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: `Test Files  1 passed (1)`, `Tests  14 passed (14)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/holidays.ts src/lib/holidays.test.ts
git commit -m "feat: parse public holidays out of an ICS feed"
```

---

## Task 3: `planHolidayImport` — the earliest-date clamp

This is the load-bearing task. Everything else is plumbing.

**Files:**
- Modify: `src/lib/holidays.ts`
- Modify: `src/lib/holidays.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/holidays.test.ts`, and add `planHolidayImport` plus `type ImportedHoliday` to the import at the top of the file:

```ts
import {
  parseHolidayIcs,
  planHolidayImport,
  type ImportedHoliday,
} from "./holidays";
```

```ts
// Real FY2027 dates. 2026-08-21 is a Friday, 2026-08-22 a Saturday,
// 2026-08-31 a Monday, 2026-11-01 a Sunday, 2026-11-02 a Monday.
const NINOY: ImportedHoliday = {
  date: "2026-08-21",
  name: "Ninoy Aquino Day",
};
const HEROES: ImportedHoliday = {
  date: "2026-08-31",
  name: "National Heroes Day",
};
const ALL_SOULS: ImportedHoliday = {
  date: "2026-11-02",
  name: "All Souls' Day",
};
const FY2027_START = "2026-08-01";
const FY2027_END = "2027-07-31";

describe("planHolidayImport", () => {
  it("plans every weekday holiday in range when nothing is recorded", () => {
    const plan = planHolidayImport(
      [NINOY, HEROES, ALL_SOULS],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan).toEqual({
      toInsert: [NINOY, HEROES, ALL_SOULS],
      alreadyMarked: 0,
      beforeRecord: 0,
    });
  });

  it("drops holidays before the range without counting them", () => {
    // Christmas 2025 is outside FY2027 entirely.
    const early: ImportedHoliday = {
      date: "2025-12-25",
      name: "Christmas Day",
    };
    const plan = planHolidayImport(
      [early, NINOY],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan).toEqual({
      toInsert: [NINOY],
      alreadyMarked: 0,
      beforeRecord: 0,
    });
  });

  it("drops holidays after the range", () => {
    const late: ImportedHoliday = {
      date: "2027-08-21",
      name: "Ninoy Aquino Day",
    };
    const plan = planHolidayImport(
      [NINOY, late],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan.toInsert).toEqual([NINOY]);
  });

  it("includes both range endpoints", () => {
    // 2026-08-03 is a Monday; 2027-07-30 is a Friday. Neither is a real
    // holiday — the point is that the bounds are inclusive.
    const first: ImportedHoliday = { date: "2026-08-03", name: "First" };
    const last: ImportedHoliday = { date: "2027-07-30", name: "Last" };
    const plan = planHolidayImport(
      [first, last],
      "2026-08-03",
      "2027-07-30",
      [],
      null
    );
    expect(plan.toInsert).toEqual([first, last]);
  });

  it("drops weekend holidays without counting them", () => {
    // 2026-11-01 is a Sunday; weekends are never stored.
    const sunday: ImportedHoliday = {
      date: "2026-11-01",
      name: "All Saints' Day",
    };
    const plan = planHolidayImport(
      [sunday, ALL_SOULS],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan).toEqual({
      toInsert: [ALL_SOULS],
      alreadyMarked: 0,
      beforeRecord: 0,
    });
  });

  it("counts a day that already has a row and does not re-insert it", () => {
    const plan = planHolidayImport(
      [NINOY, HEROES],
      FY2027_START,
      FY2027_END,
      ["2026-08-21"],
      "2026-08-21"
    );
    expect(plan).toEqual({
      toInsert: [HEROES],
      alreadyMarked: 1,
      beforeRecord: 0,
    });
  });

  // The clamp. An unclamped import would write Ninoy Aquino Day 2026-08-21,
  // move min(day_entries.date) behind the user's real first day, and make
  // fyWindowStart bill months they were not employed.
  it("counts days before the earliest entry and does not insert them", () => {
    const plan = planHolidayImport(
      [NINOY, HEROES, ALL_SOULS],
      FY2027_START,
      FY2027_END,
      ["2026-08-25"],
      "2026-08-25"
    );
    expect(plan).toEqual({
      toInsert: [HEROES, ALL_SOULS],
      alreadyMarked: 0,
      beforeRecord: 1,
    });
  });

  it("treats a null earliest entry as no clamp at all", () => {
    const plan = planHolidayImport(
      [NINOY],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan).toEqual({
      toInsert: [NINOY],
      alreadyMarked: 0,
      beforeRecord: 0,
    });
  });

  it("does not count the earliest entry's own day as before the record", () => {
    const plan = planHolidayImport(
      [NINOY],
      FY2027_START,
      FY2027_END,
      ["2026-08-21"],
      "2026-08-21"
    );
    expect(plan).toEqual({
      toInsert: [],
      alreadyMarked: 1,
      beforeRecord: 0,
    });
  });

  it("keeps toInsert in feed order", () => {
    const plan = planHolidayImport(
      [ALL_SOULS, NINOY, HEROES],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan.toInsert.map((h) => h.date)).toEqual([
      "2026-11-02",
      "2026-08-21",
      "2026-08-31",
    ]);
  });

  it("returns an empty plan for an empty feed", () => {
    expect(
      planHolidayImport([], FY2027_START, FY2027_END, [], null)
    ).toEqual({ toInsert: [], alreadyMarked: 0, beforeRecord: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: FAIL — `"planHolidayImport" is not exported by "src/lib/holidays.ts"`.

- [ ] **Step 3: Write the implementation**

Add to the top of `src/lib/holidays.ts`:

```ts
import { isWeekend } from "./rto";
```

and append:

```ts
export interface ImportPlan {
  /** Rows to write, in feed order. */
  toInsert: ImportedHoliday[];
  /** In range, but the user already has a row on that day. Left untouched. */
  alreadyMarked: number;
  /** In range, but earlier than the user's first recorded day. Never written. */
  beforeRecord: number;
}

/**
 * Which holidays to write, and why the rest were left out.
 *
 * `earliestEntry` is the user's first recorded day (`min(day_entries.date)`),
 * or null when nothing is recorded. **Nothing before it is ever written.**
 * Imported holidays are `day_entries` rows, and `fyWindowStart` derives the
 * start of a financial-year window from the earliest of them — so an unclamped
 * import would silently redefine which months a year bills. Concretely, for a
 * record beginning 11 Feb 2026, importing FY2026 without this clamp would write
 * Ninoy Aquino Day 2025, move the window start back to Aug 2025, and report a
 * five-month deficit against months of unemployment. Clamping here makes that
 * impossible by construction rather than by remembering.
 *
 * Existing rows are never overwritten, which is what makes a re-run safe and
 * what keeps a tap beating the feed.
 *
 * Out-of-range days and weekends are dropped **without a count**. They are
 * facts about the feed and the calendar rather than about the user's record,
 * and a summary reading "18 marked · 10 weekends skipped" only invites the
 * reader to wonder what went wrong.
 *
 * Pure string comparison throughout: the keys are fixed-width and zero-padded,
 * so `<` and `>` are exact calendar comparisons and no Date is constructed.
 */
export function planHolidayImport(
  holidays: ImportedHoliday[],
  startDate: string,
  endDate: string,
  existingDates: string[],
  earliestEntry: string | null
): ImportPlan {
  const existing = new Set(existingDates);
  const toInsert: ImportedHoliday[] = [];
  let alreadyMarked = 0;
  let beforeRecord = 0;

  for (const holiday of holidays) {
    if (holiday.date < startDate || holiday.date > endDate) continue;
    if (isWeekend(holiday.date)) continue;
    // Before existing: a day that already has a row cannot be before the
    // earliest entry, since that is the minimum of those rows — so the order
    // of these two cannot change a count. It reads in the order the rules were
    // decided.
    if (earliestEntry !== null && holiday.date < earliestEntry) {
      beforeRecord++;
      continue;
    }
    if (existing.has(holiday.date)) {
      alreadyMarked++;
      continue;
    }
    toInsert.push(holiday);
  }

  return { toInsert, alreadyMarked, beforeRecord };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: `Tests  25 passed (25)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/holidays.ts src/lib/holidays.test.ts
git commit -m "feat: plan a holiday import without moving the record's start"
```

---

## Task 4: `formatImportSummary` and `formatFinancialYear`

Two display formatters, both needed by the action in Task 5.

**Files:**
- Modify: `src/lib/holidays.ts`, `src/lib/holidays.test.ts`
- Modify: `src/lib/rto.ts`, `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing tests for `formatImportSummary`**

Append to `src/lib/holidays.test.ts`, adding `formatImportSummary` to the existing import:

```ts
describe("formatImportSummary", () => {
  it("reports a clean run with one clause", () => {
    expect(
      formatImportSummary({
        toInsert: [NINOY, HEROES],
        alreadyMarked: 0,
        beforeRecord: 0,
      })
    ).toBe("2 marked");
  });

  it("adds a clause for days already marked", () => {
    expect(
      formatImportSummary({
        toInsert: [NINOY],
        alreadyMarked: 3,
        beforeRecord: 0,
      })
    ).toBe("1 marked · 3 already marked");
  });

  it("adds a clause for days before the record starts", () => {
    expect(
      formatImportSummary({
        toInsert: [NINOY],
        alreadyMarked: 0,
        beforeRecord: 5,
      })
    ).toBe("1 marked · 5 before your record starts");
  });

  it("joins all three clauses", () => {
    expect(
      formatImportSummary({
        toInsert: [NINOY],
        alreadyMarked: 3,
        beforeRecord: 5,
      })
    ).toBe("1 marked · 3 already marked · 5 before your record starts");
  });

  // A re-run of a year already imported. Reads better than "nothing to do":
  // it says the year is covered.
  it("reports a fully covered year as zero marked", () => {
    expect(
      formatImportSummary({
        toInsert: [],
        alreadyMarked: 18,
        beforeRecord: 0,
      })
    ).toBe("0 marked · 18 already marked");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: FAIL — `"formatImportSummary" is not exported`.

- [ ] **Step 3: Implement `formatImportSummary`**

Append to `src/lib/holidays.ts`:

```ts
/**
 * The one line the import reports back.
 *
 * Zero-valued clauses are omitted, but the marked count always shows — "0
 * marked · 18 already marked" is how a re-run of a finished year reads, and it
 * says more than "nothing to do" would. There is no all-zero case: the action
 * reports a range error before it gets here when nothing landed in range.
 */
export function formatImportSummary(plan: ImportPlan): string {
  const parts = [`${plan.toInsert.length} marked`];
  if (plan.alreadyMarked > 0) {
    parts.push(`${plan.alreadyMarked} already marked`);
  }
  if (plan.beforeRecord > 0) {
    parts.push(`${plan.beforeRecord} before your record starts`);
  }
  return parts.join(" · ");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: `Tests  30 passed (30)`.

- [ ] **Step 5: Write the failing tests for `formatFinancialYear`**

Append to `src/lib/rto.test.ts`, adding `formatFinancialYear` to the existing import block at the top:

```ts
describe("formatFinancialYear", () => {
  it("names the year and spells out its Aug–Jul span", () => {
    expect(formatFinancialYear(2027)).toBe("FY2027 (Aug 2026 – Jul 2027)");
  });

  it("works for the year the record began", () => {
    expect(formatFinancialYear(2026)).toBe("FY2026 (Aug 2025 – Jul 2026)");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts -t "formatFinancialYear"`

Expected: FAIL — `"formatFinancialYear" is not exported by "src/lib/rto.ts"`.

- [ ] **Step 7: Implement `formatFinancialYear`**

In `src/lib/rto.ts`, insert directly **after** `formatPeriodRange` — it belongs beside the other display formatters, and `financialYearBounds` and `formatMonth` are both already defined above it, keeping the file readable top to bottom:

```ts
/**
 * "FY2027 (Aug 2026 – Jul 2027)".
 *
 * The span is spelled out because "FY2027" alone is ambiguous to anyone who has
 * not internalised an August start. Both the holiday-import picker and that
 * action's out-of-range error use this, so the two cannot disagree.
 */
export function formatFinancialYear(fy: number): string {
  const { startMonth, endMonth } = financialYearBounds(fy);
  return `FY${fy} (${formatMonth(startMonth)} – ${formatMonth(endMonth)})`;
}
```

The separator is an en dash with spaces, matching `formatPeriodRange` and `formatMandateRange`.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`

Expected: `Test Files  4 passed (4)`, `Tests  211 passed (211)`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/holidays.ts src/lib/holidays.test.ts src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: import summary and financial-year labels"
```

---

## Task 5: the `importHolidays` action

**Files:**
- Modify: `src/lib/action-state.ts`
- Create: `src/app/holiday-actions.ts`

No unit test: Vitest runs in a `node` environment with no database, and only `src/lib/` pure logic is tested in this codebase. Everything decidable was already extracted into Tasks 2–4; what remains is two queries, a fetch, and an insert. It is exercised end-to-end in Task 8.

- [ ] **Step 1: Widen `ActionState`**

Replace the type in `src/lib/action-state.ts` (keep the existing docblock above it and append the new paragraph):

```ts
/**
 * What every settings server action resolves to. `null` means "not submitted
 * yet", which is the initial state useActionState is seeded with.
 *
 * Deliberately alone in this module and exporting no runtime value, so a client
 * component can import it without pulling anything server-only into the bundle.
 *
 * `notice` carries a success summary. Note that `PeriodForm` and `MandateForm`
 * detect success as a `pending` true→false edge landing without an error, on
 * the assumption that a successful action resolves to `null`. That assumption
 * does not hold for an action returning a notice, so such an action needs its
 * own form component rather than that pattern.
 */
export type ActionState = { error?: string; notice?: string } | null;
```

This is backward compatible: all four existing consumers — `period-form.tsx`, `mandate-form.tsx`, `delete-period-button.tsx`, `delete-mandate-button.tsx` — read only `error`.

- [ ] **Step 2: Write the action**

Create `src/app/holiday-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lte, min } from "drizzle-orm";
import { db } from "@/db";
import { dayEntries } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireUserId } from "@/lib/require-user";
import { financialYearBounds, formatFinancialYear } from "@/lib/rto";
import {
  formatImportSummary,
  parseHolidayIcs,
  planHolidayImport,
} from "@/lib/holidays";

/**
 * Google's public Philippine holiday calendar. The `#` and `@` are
 * percent-encoded because they belong to the calendar id, not to URL syntax.
 *
 * Chosen over Nager.Date, which omits Eid al-Fitr, Eid al-Adha, Maulid un-Nabi
 * and All Souls' Day — five weekday holidays in 2026 alone — and cannot
 * separate observances from holidays. The country is hardcoded for the same
 * reason FY_START_MONTH is: one employer, one calendar.
 */
const ICS_URL =
  "https://calendar.google.com/calendar/ical/" +
  "en.philippines%23holiday%40group.v.calendar.google.com/public/basic.ics";

const FETCH_TIMEOUT_MS = 10_000;

export async function importHolidays(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();

  const fy = Number(formData.get("fy"));
  // A sanity bound on the input, not a claim about what the feed covers. A
  // hardcoded coverage window would rot as Google rolls the feed forward; the
  // out-of-range case below discovers the real edge instead.
  if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) {
    return { error: "Pick a financial year." };
  }

  const { startMonth, endMonth } = financialYearBounds(fy);
  const startDate = `${startMonth}-01`;
  // July has 31 days, and against a fixed-width key a bound past a short
  // month's end is harmless anyway — the same trick page.tsx uses.
  const endDate = `${endMonth}-31`;

  // One Promise.all: neon-http opens an HTTPS request per query with no
  // pipelining, so every extra await is a full round trip.
  const [[firstRow], existingRows] = await Promise.all([
    db
      .select({ first: min(dayEntries.date) })
      .from(dayEntries)
      .where(eq(dayEntries.userId, userId)),
    db
      .select({ date: dayEntries.date })
      .from(dayEntries)
      .where(
        and(
          eq(dayEntries.userId, userId),
          gte(dayEntries.date, startDate),
          lte(dayEntries.date, endDate)
        )
      ),
  ]);

  let ics: string;
  try {
    const response = await fetch(ICS_URL, {
      // Caching is opt-in in this Next version, so this is explicit rather than
      // load-bearing: an import must read the feed as it is right now.
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    ics = await response.text();
  } catch {
    return { error: "Couldn't reach the holiday feed. Try again." };
  }

  const holidays = parseHolidayIcs(ics);
  // Zero events from a feed that answered is a format change, not a year
  // without holidays. Reporting it as a successful import of nothing is exactly
  // how a silently changed feed would go unnoticed for a year.
  if (holidays.length === 0) {
    return {
      error: "The holiday feed format has changed — no holidays could be read.",
    };
  }

  const plan = planHolidayImport(
    holidays,
    startDate,
    endDate,
    existingRows.map((r) => r.date),
    firstRow?.first ?? null
  );

  // Nothing at all landed in range — a different fact from "nothing new to
  // write", which reads as "0 marked · 18 already marked" further down.
  if (
    plan.toInsert.length === 0 &&
    plan.alreadyMarked === 0 &&
    plan.beforeRecord === 0
  ) {
    return {
      error: `The feed has no holidays for ${formatFinancialYear(fy)}.`,
    };
  }

  if (plan.toInsert.length > 0) {
    // One statement, so atomic even without a transaction — neon-http has
    // none. The conflict clause closes the race between the read above and
    // this write, and Drizzle throws on an empty values array, hence the guard.
    await db
      .insert(dayEntries)
      .values(
        plan.toInsert.map((holiday) => ({
          userId,
          date: holiday.date,
          status: "holiday" as const,
          note: holiday.name,
        }))
      )
      .onConflictDoNothing();
  }

  revalidatePath("/");
  revalidatePath("/settings");
  return { notice: formatImportSummary(plan) };
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`

Expected: no output from `tsc`, and eslint reports no errors.

- [ ] **Step 4: Run the suite**

Run: `npm test`

Expected: `Test Files  4 passed (4)`, `Tests  211 passed (211)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-state.ts src/app/holiday-actions.ts
git commit -m "feat: import Philippine holidays for a financial year"
```

---

## Task 6: the settings form

**Files:**
- Create: `src/lib/clock.ts`
- Modify: `src/app/page.tsx:38-43` (remove the local `pad` and `currentMonthKey`)
- Create: `src/components/import-holidays-form.tsx`
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Extract the clock read**

Create `src/lib/clock.ts`:

```ts
/**
 * Today's month, in the **server's** local timezone.
 *
 * The app's only clock read, isolated so its caveat has a single home: it makes
 * the caller's default month — and any financial year derived from it —
 * server-timezone-dependent, and near 31 Jul / 1 Aug that month boundary is
 * also a financial-year boundary. Everything downstream of the chosen month is
 * pure month-key arithmetic; see `financialYearOf`, which takes a month key
 * precisely so it never reads a clock.
 *
 * Not in `rto.ts`: that module is pure and isomorphic, and must not read a
 * clock. Today's date on the calendar grid is resolved client-side instead, so
 * SSR output stays timezone-independent.
 */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
```

In `src/app/page.tsx`, delete the local `pad` helper and `currentMonthKey` function (lines 38–43) and import instead:

```ts
import { currentMonthKey } from "@/lib/clock";
```

`pad` is unused elsewhere in `page.tsx` — confirm with `grep -n "pad(" src/app/page.tsx` returning nothing after the edit.

- [ ] **Step 2: Write the form component**

Create `src/components/import-holidays-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { formatFinancialYear } from "@/lib/rto";

/**
 * `financialYears` and `defaultFy` are decided on the server and passed in.
 * Computing them here from the browser clock would produce a different option
 * list than the server rendered and cause a hydration mismatch.
 *
 * Not built on MandateForm: that component treats a `pending` true→false edge
 * without an error as success and resets itself, which would wipe this form's
 * notice. This one keeps its state and shows it.
 */
export function ImportHolidaysForm({
  action,
  financialYears,
  defaultFy,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  financialYears: number[];
  defaultFy: number;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            Financial year
          </span>
          <select
            name="fy"
            defaultValue={defaultFy}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          >
            {financialYears.map((fy) => (
              <option key={fy} value={fy}>
                {formatFinancialYear(fy)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50"
        >
          {pending ? "Importing…" : "Import holidays"}
        </button>
      </div>
      {state?.error && (
        <p
          role="alert"
          className="border-l-2 border-stamp pl-3 text-sm text-stamp"
        >
          {state.error}
        </p>
      )}
      {state?.notice && (
        <p role="status" className="border-l-2 border-fade pl-3 font-mono text-sm">
          {state.notice}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Add the settings section**

In `src/app/settings/page.tsx`, add to the imports:

```ts
import { financialYearOf } from "@/lib/rto";
import { currentMonthKey } from "@/lib/clock";
import { importHolidays } from "@/app/holiday-actions";
import { ImportHolidaysForm } from "@/components/import-holidays-form";
```

`financialYearOf` joins the existing `DEFAULT_RTO_PERCENT` import from `@/lib/rto`.

After `const mandates = await db...`, add:

```tsx
  // The current FY plus the four before and one after. Derived on the server so
  // the option list is identical in SSR and hydration; the clock read means a
  // render within a day of 1 August can preselect the neighbouring FY, which is
  // a dropdown default the user can change and feeds no arithmetic.
  const currentFy = financialYearOf(currentMonthKey());
  const financialYears = [-4, -3, -2, -1, 0, 1].map((offset) => currentFy + offset);
```

Then, after the "Add a mandate" panel and before the closing `</section>`:

```tsx
        <div className="border-t border-rule pt-6">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-fade uppercase">
            Philippine holidays
          </p>
          <p className="mt-2 text-sm text-fade">
            Fetches the Philippine public holiday list and marks those weekdays
            as holidays, which removes them from your eligible days. Days you
            have already marked are left alone, and nothing is written before
            your record starts. Safe to run again — it only fills in what is
            missing.
          </p>
        </div>

        <div className="border border-rule bg-white/40 p-4">
          <p className="mb-3 font-mono text-[10px] tracking-widest text-fade uppercase">
            Import a year
          </p>
          <ImportHolidaysForm
            action={importHolidays}
            financialYears={financialYears}
            defaultFy={currentFy}
          />
        </div>
```

- [ ] **Step 4: Type-check, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`

Expected: clean, and `Test Files  4 passed (4)`, `Tests  211 passed (211)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clock.ts src/app/page.tsx src/components/import-holidays-form.tsx src/app/settings/page.tsx
git commit -m "feat: import holidays from the settings page"
```

---

## Task 7: holiday names in the calendar

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/calendar.tsx`

- [ ] **Step 1: Select and narrow the notes in `page.tsx`**

Add `note` to the `day_entries` select — it is the query inside the second `Promise.all`:

```ts
    db
      .select({
        date: dayEntries.date,
        status: dayEntries.status,
        note: dayEntries.note,
      })
      .from(dayEntries)
      .where(
        and(
          eq(dayEntries.userId, session.user.id),
          gte(dayEntries.date, `${queryStart}-01`),
          lte(dayEntries.date, `${monthKey}-31`)
        )
      ),
```

Then, after the existing `monthEntries` block, add:

```ts
  // Every note in the displayed month, whatever the day's status — not just
  // the holidays. A note outlives a status change (setDayStatus writes only
  // `status`), so a day cycled holiday → office still has its name, and
  // cycling it back to holiday must show that name again on the same tap.
  // Filtering by status here would leave the footnote blank until a reload.
  const monthNotes: Record<string, string> = Object.fromEntries(
    rows.flatMap((r) =>
      r.date.startsWith(monthKey) && r.note !== null
        ? [[r.date, r.note] as [string, string]]
        : []
    )
  );
```

And pass it to `Calendar`, after `initialEntries`:

```tsx
        initialEntries={monthEntries}
        notes={monthNotes}
```

`aggregateMonths` ignores the extra field on the window-wide rows, so nothing else changes.

- [ ] **Step 2: Accept the prop in `Calendar`**

In `src/components/calendar.tsx`, add to the props type and destructuring:

```tsx
export function Calendar({
  monthKey,
  initialEntries,
  notes,
  targetPercent,
  mandates,
  fyBaseline,
}: {
  monthKey: string;
  initialEntries: Entries;
  /**
   * Display names for days in this month, keyed by date. A separate prop rather
   * than a richer `Entries`: that type is `Record<string, DayStatus>` throughout
   * `rto.ts` and every arithmetic function takes it, so widening it would touch
   * all of them to carry a string none of them read.
   */
  notes: Record<string, string>;
  targetPercent: number;
  mandates: WfhMandate[];
  fyBaseline: FyBaseline | null;
}) {
```

- [ ] **Step 3: Derive the list from live state**

After the `const weeks = monthGrid(year, month);` line, add:

```tsx
  // Filtered against live `entries`, not against the props alone, so cycling a
  // day off `holiday` drops it from the list on the same tap that changes the
  // cell — and cycling one back adds it again.
  const namedHolidays = Object.entries(notes)
    .filter(([date]) => entries[date] === "holiday")
    .sort(([a], [b]) => a.localeCompare(b));
```

- [ ] **Step 4: Render the footnote**

In `src/components/calendar.tsx`, insert between the closing `</div>` of the grid and the existing `<p className="text-xs text-fade">` hint:

```tsx
      {namedHolidays.length > 0 && (
        <div className="space-y-1 border-l-2 border-fade pl-3">
          <p className="font-mono text-[10px] tracking-widest text-fade uppercase">
            Holidays
          </p>
          {namedHolidays.map(([date, name]) => (
            <p key={date} className="font-mono text-xs text-fade">
              <span className="mr-2 inline-block w-4 text-right tabular-nums">
                {Number(date.slice(-2))}
              </span>
              {name}
            </p>
          ))}
        </div>
      )}
```

Names go here rather than in the cells because a weekday cell is ~119px wide on desktop and ~47px inside its padding on a 375px phone, where `HOLIDAY` at `text-[10px] tracking-widest` already fills the width. The `border-l-2 border-fade pl-3` idiom matches the mandate banner in `page.tsx`. Holidays marked by hand carry no note and so do not appear — the heading lists named holidays, it does not claim to be every holiday in the month.

- [ ] **Step 5: Type-check, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`

Expected: clean, and `Test Files  4 passed (4)`, `Tests  211 passed (211)`.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/components/calendar.tsx
git commit -m "feat: list named holidays under the month grid"
```

---

## Task 8: documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`

No ADR. This feature adds no rule that constrains later work the way the financial-year or migration decisions do; its one durable invariant is the clamp, which belongs in `CLAUDE.md` beside `fyWindowStart`.

- [ ] **Step 1: Document the import in `CLAUDE.md`**

In the **Architecture** section, insert after the `Mandated WFH days are excluded outright.` paragraph and before `Compliance is cumulative within a financial year`:

```markdown
**Imported public holidays are ordinary `day_entries` rows.** `importHolidays` in
`src/app/holiday-actions.ts` reads Google's public Philippine holiday ICS feed and writes
`status: "holiday"` rows for one financial year at a time, with the holiday's name in the
new nullable `note` column — display copy only, never parsed, exactly like
`wfh_mandates.reason`. Nothing about the arithmetic changes: `isEligible` already excludes
`holiday`, so the requirement falls out for free. The country is hardcoded for the same
reason `FY_START_MONTH` is.

Being rows rather than a third overlay is the design, not laziness. **A tap must beat the
feed** — a proclamation can be revoked, or the office opens anyway — and an overlay would
inherit the mandate rule, where the exclusion beats anything the user tapped. As rows, a
tap simply rewrites them. The import never overwrites an existing row, which is what makes
a re-run safe.

**The import never writes a day earlier than `min(day_entries.date)`.** This is the
feature's one load-bearing invariant, enforced and tested in `planHolidayImport`
(`src/lib/holidays.ts`), never in the action. Imported holidays *are* `day_entries` rows,
so `fyWindowStart` derives an FY window's start from them — an unclamped import would
silently redefine which months a year bills. For a record beginning 11 Feb 2026,
importing FY2026 without the clamp would write Ninoy Aquino Day 2025, move the window
start back to Aug 2025, and report a five-month deficit against months of unemployment.

`parseHolidayIcs` keeps only events whose ICS `DESCRIPTION` begins `Public holiday`. That
is an allowlist on purpose: the live feed carries exactly two values, `Public holiday` and
`Observance`, and were the field renamed, an allowlist marks nothing and the action says
so, where a denylist would mark Easter Sunday a holiday and quietly lower the requirement.
An empty parse from a feed that answered is therefore reported as a format change, not as
a year without holidays.

`day_entries.note` survives a status change and dies with the row: `setDayStatus` upserts
`set: { status }` only. So cycling 25 Dec holiday → office keeps "Christmas Day" attached,
and the calendar footnote — which requires `status === "holiday"` — simply stops listing
it. `page.tsx` therefore sends `<Calendar>` **every** note in the month, not only those on
holiday rows; filtering by status server-side would leave the footnote blank until a
reload.
```

Then, in the **Data flow** section, find the sentence ending `and hands <Calendar> a plain Entries map of just that month's rows, alongside the FyBaseline for the months before it.` and replace it with:

```markdown
and hands `<Calendar>` a plain `Entries` map of just that month's rows, a `notes` map of
every note in that month whatever the row's status, and the `FyBaseline` for the months
before it.
```

- [ ] **Step 2: Document it in `docs/architecture.md`**

Under **Data model**, the `day_entries` block gains a row (`docs/architecture.md:18-24`):

```
day_entries
  user_id  text  → users.id (cascade delete)
  date     text  'YYYY-MM-DD'
  status   enum  'office' | 'leave' | 'holiday'
  note     text  nullable; imported holiday's name, display only
  PRIMARY KEY (user_id, date)
```

Under **Computation rules**, add one bullet after the `Mandated WFH days come from ...` bullet:

```markdown
- Imported public holidays need no rule of their own: they are `holiday` rows in
  `day_entries`, already out of the eligible pool, and a tap overwrites them
```

Under **Data flow**, append a paragraph after the FY-window paragraph:

```markdown
The settings page can import Philippine public holidays for one financial year: it fetches
Google's public PH holiday ICS feed, keeps only events described as public holidays, and
plans the write with `planHolidayImport` — which drops weekends, never overwrites an
existing row, and never writes a day earlier than the user's first recorded one, so the
import cannot move the FY window's start. The surviving days are inserted as `holiday`
rows in a single statement, and `/` and `/settings` are revalidated.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/architecture.md
git commit -m "docs: record how imported holidays reach day entries"
```

---

## Task 9: full verification

**Files:** none — this task only runs things.

- [ ] **Step 1: The whole suite and the linter**

Run: `make test && make lint`

Expected: `Test Files  4 passed (4)`, `Tests  211 passed (211)`, and eslint silent.

- [ ] **Step 2: A production build**

Run: `npm run build`

Expected: completes with no type errors. This is the check that matters most for `page.tsx` and `settings/page.tsx`, which have no unit tests — `next build` type-checks against `schema.ts`, so it also catches a `note` reference that the migration forgot.

- [ ] **Step 3: Verify the migration is recorded**

Run: `npm run db:check`

Expected: the journal validates. Then confirm the journal has two entries and `drizzle/` has two `.sql` files:

```bash
git status --short && ls drizzle/*.sql
```

Expected: a clean tree, and both `0000_*.sql` and `0001_*.sql` present and committed.

- [ ] **Step 4: Exercise it against the dev branch**

Run: `npm run dev`, sign in, and go to `/settings`.

1. Import **FY2027**. Expected notice: `18 marked` on a record with no August 2026 entries, or a count reduced by however many of the 18 you had already marked, plus an `already marked` clause.
2. Go to `/?m=2026-08`. Expected: 21, 26 and 31 August show `HOLIDAY`, and the footnote under the grid reads:

   ```
   HOLIDAYS
   21  Ninoy Aquino Day
   26  Maulid un-Nabi
   31  National Heroes Day
   ```
3. Check the month meter fell. August 2026 has 21 weekdays; three holidays leave 18 eligible, so at 40% the requirement drops from `ceil(21 × 0.4) = 9` to `ceil(18 × 0.4) = 8`.
4. Tap 31 August once — holiday → WFH. Expected: `National Heroes Day` disappears from the footnote immediately, and the requirement returns to 9.
5. Tap it three more times back to `holiday`. Expected: the name **does not** return, because tapping to WFH deleted the row and its note. Re-importing FY2027 restores both — expected notice `1 marked · 17 already marked`.
6. Re-import FY2027 with nothing changed. Expected: `0 marked · 18 already marked` — no duplicates, no error.
7. Import an FY the feed cannot cover, e.g. **FY2040** if the picker reaches it, or temporarily widen the offsets to check. Expected: `The feed has no holidays for FY2040 (Aug 2039 – Jul 2040).`

- [ ] **Step 5: Confirm the clamp, the invariant this feature exists to protect**

With a record whose earliest entry is in Feb 2026, import **FY2026** (Aug 2025 – Jul 2026).

Expected: the notice includes a `before your record starts` clause counting the FY2026 weekday holidays that fall between 1 Aug 2025 and the day before your first entry. Then check `/?m=2025-08` — expected: **no** holidays marked there, and browsing FY2026 must not have started billing from Aug 2025. Confirm the window start did not move:

```bash
grep -n "fyWindowStart\|trackingStart" src/app/page.tsx
```

The FY block on `/?m=2026-02` should still say `counted from Feb 2026`, not `counted from Aug 2025`.

- [ ] **Step 6: Final commit if anything drifted**

```bash
git status --short
```

Expected: clean. `next dev` rewrites the `AGENTS.md` block; if it shows as modified, commit it with the work rather than reverting it — reverting only re-creates the change.

---

## Deferred to the next spec

Not in scope here, and named so nobody adds them mid-plan:

- **Employment start date.** The clamp fixes which *months* FY2026 counts, but Feb 2026's own eligible days still include 2–10 Feb, before the user joined. That over-counts February and FY2026.
- **Clearing a month's marks.**
- **Any country but PH**, and any per-user country setting.
- **Scheduled or automatic import.** Writing rows during a server-component render is the reason: a GET that mutates would also race concurrent renders.
- **Distinguishing regular holidays from special non-working days.** The feed does not carry the distinction, and both leave the eligible pool identically.

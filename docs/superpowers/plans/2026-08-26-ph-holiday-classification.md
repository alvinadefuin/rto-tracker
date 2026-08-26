# Philippine Holiday Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark only nationwide non-working holidays as `holiday` days, and list a month's whole holiday calendar — weekend holidays included — under the grid.

**Architecture:** A 27-name allowlist in `src/lib/holidays.ts` decides what counts; `planHolidayImport` applies it and additionally returns a `reference` list that keeps weekend holidays. Those reference rows go to a new global `ph_holidays` table, which is the PH calendar and feeds display only — `day_entries` stays the user's record and the sole input to the arithmetic, so a tap still beats the feed.

**Tech Stack:** Next.js 16.3 (App Router), React 19, Drizzle ORM 0.45, Neon Postgres, Auth.js v5, Tailwind v4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-26-ph-holiday-classification-design.md`

---

## Before you start

Read `CLAUDE.md` and `AGENTS.md` in the repo root. The invariants that govern these tasks:

1. **Dates are text, never `Date`.** Day keys are `YYYY-MM-DD`, month keys `YYYY-MM`, both zero-padded and fixed-width, so `<` and `>` on the strings are exact calendar comparisons. Never `new Date("2026-12-25")`.
2. **`src/lib/holidays.ts` and `src/lib/rto.ts` are pure and isomorphic.** No database, no network, no clock.
3. **Absence of a row on a weekday means WFH.** The enum is `office | leave | holiday`; weekends are never stored in `day_entries`. `ph_holidays` is a different table and deliberately *does* hold weekend dates.
4. **The import must never move `trackingStart`.** `fyWindowStart` derives an FY window's start from `min(day_entries.date)`. The clamp lives in `planHolidayImport` and applies to `toInsert` only — `reference` is not clamped, and must not be, because `ph_holidays` is not read by `fyWindowStart`.
5. **Schema changes travel as committed migrations.** Editing `src/db/schema.ts` means `npm run db:generate`, reading the emitted SQL, `npm run db:migrate`, and committing `drizzle/` in the same commit.

Confirm a green baseline:

```bash
npm test
```

Expected: `Test Files  4 passed (4)`, `Tests  211 passed (211)`.

Only Task 1 touches `src/db/schema.ts`. If you edit it in any other task, stop — you have gone off-plan.

### Feed facts asserted below

Verified against the live feed on 2026-08-26. Do not "correct" them.

| Fact | Value |
|---|---|
| Total events | 311, spanning 2021–2031 |
| `DESCRIPTION` values | exactly two: `Public holiday` (271), `Observance` (40) |
| Distinct public-holiday names, after stripping `(tentative)` | 35 |
| Of those, nationwide | 27 |
| Of those, dropped | 8 |
| FY2027 weekday holidays before this change | 18 |
| FY2027 weekday holidays after | **15** |
| FY2027: 260 weekdays, so required at 40% | 97 → **98** |

The three FY2027 days this change removes: `2026-08-26` Maulid un-Nabi, `2027-01-06` Lailatul Isra Wal Mi Raj, `2027-05-18` Eid al-Adha Holiday.

---

## File Structure

**Create:**
- `drizzle/0002_<generated_name>.sql` — the `ph_holidays` migration (Task 1).

**Modify:**
- `src/db/schema.ts` — add the `phHolidays` table.
- `src/lib/holidays.ts` — `NATIONWIDE_HOLIDAYS`, `isNationwideHoliday`, and `reference` on `ImportPlan`.
- `src/lib/holidays.test.ts` — tests for both.
- `src/app/holiday-actions.ts` — write the reference rows.
- `src/app/page.tsx` — query `ph_holidays`; drop `monthNotes` and the `notes` prop.
- `src/components/calendar.tsx` — take `holidays`, render the annotated list.
- `CLAUDE.md`, `docs/architecture.md`.

**Not touched:** `src/app/actions.ts`, `src/lib/rto.ts`, `src/lib/clock.ts`, `src/lib/action-state.ts`, `src/components/import-holidays-form.tsx`, `src/app/settings/page.tsx`, `src/components/stats.tsx`.

---

## Task 1: the `ph_holidays` table

**Files:**
- Modify: `src/db/schema.ts` (append after `wfhMandates`)
- Create: `drizzle/0002_<generated_name>.sql` (drizzle-kit picks the name)
- Modify: `drizzle/meta/_journal.json`, `drizzle/meta/0002_snapshot.json` (both generated)

No test. Schema change with no logic; exercised end-to-end in Task 7.

- [ ] **Step 1: Add the table**

Append to the end of `src/db/schema.ts`:

```ts
/**
 * The Philippine public holiday calendar, as imported from Google's ICS feed.
 *
 * Global on purpose — no `user_id`. PH holidays are the same for everyone and
 * are public data, so a per-user copy would only duplicate rows. This table is
 * the *calendar*; `day_entries` is the user's *record*. Nothing computed reads
 * this: it feeds the month footnote only, which is what keeps a tap beating the
 * feed. It deliberately holds weekend dates, which `day_entries` never does.
 */
export const phHolidays = pgTable("ph_holidays", {
  date: text("date").primaryKey(), // YYYY-MM-DD; text avoids TZ drift
  name: text("name").notNull(),
});
```

`pgTable` and `text` are already imported at the top of the file.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

Expected: a new file `drizzle/0002_<something>.sql`.

- [ ] **Step 3: Read the generated SQL**

Run: `cat drizzle/0002_*.sql`

Expected — a single `CREATE TABLE` and nothing else:

```sql
CREATE TABLE "ph_holidays" (
	"date" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
```

**If you see a `DROP`, an `ALTER` touching another table, or any statement mentioning `day_entries`, stop and report it.** This migration must be purely additive — that is what lets it deploy without an expand-then-contract pair.

- [ ] **Step 4: Apply it to the dev branch**

Run: `npm run db:migrate`

Expected: completes with no error, and the final line reports a count that is not *short* of the journal — e.g. `up to date — 4 of 3 migration(s) recorded`. A surplus is pre-existing dev-branch drift and is fine; a **shortfall** fails the command and means the migration was skipped as out-of-order.

- [ ] **Step 5: Confirm nothing else drifted**

Run: `npm run db:check && npm test`

Expected: the journal validates, and `Test Files  4 passed (4)`, `Tests  211 passed (211)`.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: ph_holidays reference calendar table"
```

---

## Task 2: `isNationwideHoliday`

**Files:**
- Modify: `src/lib/holidays.ts`
- Modify: `src/lib/holidays.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `isNationwideHoliday` to the existing import block at the top of `src/lib/holidays.test.ts`, so it reads:

```ts
import {
  formatImportSummary,
  isNationwideHoliday,
  parseHolidayIcs,
  planHolidayImport,
  type ImportedHoliday,
} from "./holidays";
```

Then append to the file:

```ts
// Every distinct name the live feed uses across 2021–2031, after stripping a
// trailing "(tentative)". Checked as one table so the classification is
// reviewable in one place, and so adding a name to the allowlist without
// deciding this list's verdict is impossible.
const KEPT_NAMES = [
  // Regular holidays (RA 9849), nationwide
  "New Year's Day",
  "The Day of Valor",
  "Maundy Thursday",
  "Good Friday",
  "Labor Day",
  "Independence Day",
  "National Heroes Day",
  "Bonifacio Day",
  "Christmas Day",
  "Rizal Day",
  "Eid al-Fitr",
  "Eid al-Adha",
  // Special non-working days, nationwide
  "Ninoy Aquino Day",
  "All Saints' Day",
  "All Souls' Day",
  "Feast of the Immaculate Conception",
  "Christmas Eve",
  "New Year's Eve",
  "Black Saturday",
  "Lunar New Year's Day",
  "Special Day after Christmas",
  "Special non-working day after New Year",
  "National Elections",
  // Substitute and additional proclaimed days
  "Day off for Bonifacio Day",
  "Day off for People Power Anniversary",
  "Ninoy Aquino Day Holiday",
  "Lunar New Year Holiday",
];

const DROPPED_NAMES = [
  // Non-working in BARMM only
  "Maulid un-Nabi",
  "Lailatul Isra Wal Mi Raj",
  "Amun Jadid",
  "Eid al-Fitr Holiday",
  "Eid al-Adha Holiday",
  // Special *working* days, or too variable year to year to assume
  "Reformation Day",
  "People Power Anniversary",
  "Founding Anniversary of Iglesia ni Cristo",
];

describe("isNationwideHoliday", () => {
  it("covers all 35 names the feed uses", () => {
    expect(KEPT_NAMES.length + DROPPED_NAMES.length).toBe(35);
  });

  it.each(KEPT_NAMES)("keeps %s", (name) => {
    expect(isNationwideHoliday(name)).toBe(true);
  });

  it.each(DROPPED_NAMES)("drops %s", (name) => {
    expect(isNationwideHoliday(name)).toBe(false);
  });

  it("strips a trailing (tentative) before matching", () => {
    expect(isNationwideHoliday("Eid al-Fitr (tentative)")).toBe(true);
  });

  it("drops a tentative regional holiday too", () => {
    expect(isNationwideHoliday("Eid al-Adha Holiday (tentative)")).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isNationwideHoliday("  Rizal Day  ")).toBe(true);
  });

  // The deliberate failure direction: an unknown name is dropped, which leaves
  // the day eligible and the requirement higher. A denylist would mark it and
  // quietly lower the requirement instead.
  it("drops a name it has never seen", () => {
    expect(isNationwideHoliday("Founding Day of Something New")).toBe(false);
  });

  it("does not match a partial name", () => {
    expect(isNationwideHoliday("Christmas")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: FAIL — `isNationwideHoliday is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/holidays.ts`:

```ts
/**
 * Holidays that are non-working nationwide, by the name the feed gives them.
 *
 * An allowlist, not a denylist on the regional names, for the same reason the
 * DESCRIPTION check is one: **the two directions fail differently.** An
 * unrecognised name is dropped, which leaves the day eligible and the
 * requirement *higher* — the user works a day they may not have needed to, and
 * fixes it with a tap. A denylist that missed a new regional holiday would mark
 * it and silently *lower* the requirement, and nothing would ever surface that.
 *
 * The accepted cost: a genuinely new nationwide holiday is dropped until
 * someone adds it here. No test can catch that, because the tests have no feed.
 *
 * Excluded on purpose, and checked against the live feed's own dates:
 *
 * - **Maulid un-Nabi, Lailatul Isra Wal Mi Raj, Amun Jadid** — non-working in
 *   BARMM, not nationwide. This is the case that prompted the list.
 * - **`Eid al-Fitr Holiday` / `Eid al-Adha Holiday`** — a *second* day, not a
 *   weekend substitute: each falls the day after its Eid whatever the weekday
 *   (Tue→Wed 2021, Mon→Tue 2024, Fri→Sat 2025, Mon→Tue 2027). `Day off for X`
 *   below is the genuine moved observance, which is why the two are treated
 *   differently despite looking alike.
 * - **People Power Anniversary** — a special *working* day in most years. 2023
 *   carries both it and a separate `Day off for People Power Anniversary`,
 *   which is the tell: when the day is really non-working the feed says so.
 * - **Reformation Day** — flips between working and non-working year to year.
 * - **Founding Anniversary of Iglesia ni Cristo** — a special working day.
 */
const NATIONWIDE_HOLIDAYS = new Set([
  // Regular holidays (RA 9849)
  "New Year's Day",
  "The Day of Valor",
  "Maundy Thursday",
  "Good Friday",
  "Labor Day",
  "Independence Day",
  "National Heroes Day",
  "Bonifacio Day",
  "Christmas Day",
  "Rizal Day",
  "Eid al-Fitr",
  "Eid al-Adha",
  // Special non-working days
  "Ninoy Aquino Day",
  "All Saints' Day",
  "All Souls' Day",
  "Feast of the Immaculate Conception",
  "Christmas Eve",
  "New Year's Eve",
  "Black Saturday",
  "Lunar New Year's Day",
  "Special Day after Christmas",
  "Special non-working day after New Year",
  "National Elections",
  // Substitute and additional proclaimed days
  "Day off for Bonifacio Day",
  "Day off for People Power Anniversary",
  "Ninoy Aquino Day Holiday",
  "Lunar New Year Holiday",
]);

/**
 * Whether a feed holiday is non-working nationwide.
 *
 * The `(tentative)` suffix Google appends to unconfirmed Islamic dates is
 * stripped first: it qualifies the date, not the holiday, so
 * "Eid al-Fitr (tentative)" must classify exactly as "Eid al-Fitr" does.
 */
export function isNationwideHoliday(name: string): boolean {
  return NATIONWIDE_HOLIDAYS.has(
    name.replace(/\s*\(tentative\)\s*$/, "").trim()
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: `Tests  71 passed (71)` in this file — the 30 that were there plus 41 new: 1 coverage
check, 27 from `it.each(KEPT_NAMES)`, 8 from `it.each(DROPPED_NAMES)`, and 5 behavioural cases.
`npm test` across all four files reports `Tests  252 passed (252)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/holidays.ts src/lib/holidays.test.ts
git commit -m "feat: classify which PH holidays are non-working nationwide"
```

---

## Task 3: `reference` on the import plan

The load-bearing task. `toInsert` must keep every rule it has today; `reference` deliberately has fewer.

**Files:**
- Modify: `src/lib/holidays.ts`
- Modify: `src/lib/holidays.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/holidays.test.ts`. `NINOY`, `HEROES`, `ALL_SOULS`, `FY2027_START` and `FY2027_END` are already defined above in the file — do not redefine them.

```ts
// 2026-11-01 is a Sunday; 2026-08-26 is a Wednesday.
const ALL_SAINTS: ImportedHoliday = {
  date: "2026-11-01",
  name: "All Saints' Day",
};
const MAULID: ImportedHoliday = {
  date: "2026-08-26",
  name: "Maulid un-Nabi",
};

describe("planHolidayImport — nationwide filter", () => {
  it("does not mark a regional holiday", () => {
    const plan = planHolidayImport(
      [NINOY, MAULID, HEROES],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan.toInsert).toEqual([NINOY, HEROES]);
  });

  // Dropped like weekends and out-of-range days: a fact about the feed, not
  // about the user's record, so a summary must not invite them to wonder.
  it("does not count a regional holiday in any tally", () => {
    const plan = planHolidayImport(
      [MAULID],
      FY2027_START,
      FY2027_END,
      ["2026-08-26"],
      "2026-08-01"
    );
    expect(plan).toEqual({
      toInsert: [],
      reference: [],
      alreadyMarked: 0,
      beforeRecord: 0,
    });
  });

  it("keeps a tentative nationwide holiday", () => {
    const eid: ImportedHoliday = {
      date: "2027-03-10",
      name: "Eid al-Fitr (tentative)",
    };
    const plan = planHolidayImport([eid], FY2027_START, FY2027_END, [], null);
    expect(plan.toInsert).toEqual([eid]);
  });
});

describe("planHolidayImport — reference calendar", () => {
  it("keeps weekend holidays that toInsert drops", () => {
    const plan = planHolidayImport(
      [ALL_SAINTS, ALL_SOULS],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan.toInsert).toEqual([ALL_SOULS]);
    expect(plan.reference).toEqual([ALL_SAINTS, ALL_SOULS]);
  });

  // The reference calendar is the calendar, not the user's record.
  // fyWindowStart reads day_entries only, so an unclamped reference row cannot
  // move a financial year's start — and clamping it would hide real holidays
  // from the footnote for months before the record began.
  it("ignores the earliest-entry clamp", () => {
    const plan = planHolidayImport(
      [NINOY, HEROES],
      FY2027_START,
      FY2027_END,
      [],
      "2026-08-25"
    );
    expect(plan.toInsert).toEqual([HEROES]);
    expect(plan.beforeRecord).toBe(1);
    expect(plan.reference).toEqual([NINOY, HEROES]);
  });

  it("includes days the user has already marked", () => {
    const plan = planHolidayImport(
      [NINOY, HEROES],
      FY2027_START,
      FY2027_END,
      ["2026-08-21"],
      "2026-08-21"
    );
    expect(plan.toInsert).toEqual([HEROES]);
    expect(plan.alreadyMarked).toBe(1);
    expect(plan.reference).toEqual([NINOY, HEROES]);
  });

  it("excludes regional holidays", () => {
    const plan = planHolidayImport(
      [NINOY, MAULID],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan.reference).toEqual([NINOY]);
  });

  it("still respects the date range", () => {
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
    expect(plan.reference).toEqual([NINOY]);
  });

  it("keeps feed order", () => {
    const plan = planHolidayImport(
      [ALL_SOULS, ALL_SAINTS, NINOY],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan.reference.map((h) => h.date)).toEqual([
      "2026-11-02",
      "2026-11-01",
      "2026-08-21",
    ]);
  });

  it("is empty for an empty feed", () => {
    expect(
      planHolidayImport([], FY2027_START, FY2027_END, [], null).reference
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Update the existing plan tests for the new field**

Two separate breakages to repair in the existing `describe("planHolidayImport", ...)` block.

**(a) The allowlist breaks one test outright.** `"includes both range endpoints"` uses the
placeholder names `"First"` and `"Last"`, which are not on the allowlist, so `toInsert` would come
back empty. Replace that test's two fixtures with allowlisted names — the date/name pairing is
deliberately artificial, because the test is about the range bounds being inclusive, not about
either holiday's real date:

```ts
  it("includes both range endpoints", () => {
    // 2026-08-03 is a Monday; 2027-07-30 is a Friday. Neither is the real date
    // of the holiday named — the names only need to pass the nationwide
    // allowlist, and the assertion is that both bounds are inclusive.
    const first: ImportedHoliday = { date: "2026-08-03", name: "Labor Day" };
    const last: ImportedHoliday = { date: "2027-07-30", name: "Rizal Day" };
    const plan = planHolidayImport(
      [first, last],
      "2026-08-03",
      "2027-07-30",
      [],
      null
    );
    expect(plan.toInsert).toEqual([first, last]);
  });
```

**(b) Eight assertions gain the new key.** Every `expect(plan).toEqual({` in that block now fails
on a missing `reference`. The eight become:

```ts
// "plans every weekday holiday in range when nothing is recorded"
expect(plan).toEqual({
  toInsert: [NINOY, HEROES, ALL_SOULS],
  reference: [NINOY, HEROES, ALL_SOULS],
  alreadyMarked: 0,
  beforeRecord: 0,
});

// "drops holidays before the range without counting them"
expect(plan).toEqual({
  toInsert: [NINOY],
  reference: [NINOY],
  alreadyMarked: 0,
  beforeRecord: 0,
});

// "drops weekend holidays without counting them"  — the Sunday IS in reference
expect(plan).toEqual({
  toInsert: [ALL_SOULS],
  reference: [
    { date: "2026-11-01", name: "All Saints' Day" },
    ALL_SOULS,
  ],
  alreadyMarked: 0,
  beforeRecord: 0,
});

// "counts a day that already has a row and does not re-insert it"
expect(plan).toEqual({
  toInsert: [HEROES],
  reference: [NINOY, HEROES],
  alreadyMarked: 1,
  beforeRecord: 0,
});

// "counts days before the earliest entry and does not insert them"
expect(plan).toEqual({
  toInsert: [HEROES, ALL_SOULS],
  reference: [NINOY, HEROES, ALL_SOULS],
  alreadyMarked: 0,
  beforeRecord: 1,
});

// "treats a null earliest entry as no clamp at all"
expect(plan).toEqual({
  toInsert: [NINOY],
  reference: [NINOY],
  alreadyMarked: 0,
  beforeRecord: 0,
});

// "does not count the earliest entry's own day as before the record"
expect(plan).toEqual({
  toInsert: [],
  reference: [NINOY],
  alreadyMarked: 1,
  beforeRecord: 0,
});

// "returns an empty plan for an empty feed"
expect(
  planHolidayImport([], FY2027_START, FY2027_END, [], null)
).toEqual({ toInsert: [], reference: [], alreadyMarked: 0, beforeRecord: 0 });
```

The `formatImportSummary` tests construct an `ImportPlan` literal too. Add `reference: []` to each of the five, e.g.:

```ts
formatImportSummary({
  toInsert: [NINOY, HEROES],
  reference: [],
  alreadyMarked: 0,
  beforeRecord: 0,
})
```

The two remaining tests that assert only `plan.toInsert` — `"drops holidays after the range"` and
`"keeps toInsert in feed order"` — use allowlisted fixtures already and need no change.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: FAIL — the new `reference` assertions report `undefined`, and the updated `toEqual` assertions report a missing `reference` key.

- [ ] **Step 4: Write the implementation**

In `src/lib/holidays.ts`, add the field to `ImportPlan`:

```ts
export interface ImportPlan {
  /** Rows to write to `day_entries`, in feed order. */
  toInsert: ImportedHoliday[];
  /**
   * Rows for the `ph_holidays` reference calendar, in feed order.
   *
   * Nationwide and in range, but **weekends included and the earliest-entry
   * clamp not applied** — this is the calendar, not the user's record, and
   * `fyWindowStart` reads `day_entries` only, so these cannot move a financial
   * year's start. Clamping them would blank the footnote for months before the
   * record began, where the holidays are real even though the days are not
   * counted.
   */
  reference: ImportedHoliday[];
  /** In range, but the user already has a row on that day. Left untouched. */
  alreadyMarked: number;
  /** In range, but earlier than the user's first recorded day. Never written. */
  beforeRecord: number;
}
```

Then replace the body of `planHolidayImport` (the signature and docblock stay as they are, apart from the addition below):

```ts
export function planHolidayImport(
  holidays: ImportedHoliday[],
  startDate: string,
  endDate: string,
  existingDates: string[],
  earliestEntry: string | null
): ImportPlan {
  const existing = new Set(existingDates);
  const toInsert: ImportedHoliday[] = [];
  const reference: ImportedHoliday[] = [];
  let alreadyMarked = 0;
  let beforeRecord = 0;

  for (const holiday of holidays) {
    if (holiday.date < startDate || holiday.date > endDate) continue;
    // Before the weekend check, so a regional holiday never reaches the
    // reference calendar either — the footnote lists what the office observes.
    if (!isNationwideHoliday(holiday.name)) continue;

    // The reference calendar takes every nationwide holiday in range, weekends
    // and all, and is not clamped. Everything below narrows the user's record.
    reference.push(holiday);

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

  return { toInsert, reference, alreadyMarked, beforeRecord };
}
```

Add one paragraph to the existing `planHolidayImport` docblock, after the "Existing rows are never overwritten" paragraph:

```
 * Only holidays that are non-working nationwide are considered at all; see
 * `isNationwideHoliday`. A regional holiday reaches neither the user's record
 * nor the reference calendar, and is dropped without a count, exactly as
 * weekends and out-of-range days are.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/holidays.test.ts`

Expected: `Tests  81 passed (81)` in this file — the 71 from Task 2 plus 10 new (3 nationwide-filter
cases and 7 reference-calendar cases).

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lib/holidays.ts src/lib/holidays.test.ts
git commit -m "feat: plan a reference calendar alongside the user's holiday rows"
```

Expected: `tsc` prints nothing. `holiday-actions.ts` builds an `ImportPlan` only by calling `planHolidayImport`, so it needs no change to type-check.

---

## Task 4: write the reference rows

**Files:**
- Modify: `src/app/holiday-actions.ts`

No unit test: Vitest runs in a `node` environment with no database, and only `src/lib/` pure logic is tested here. Everything decidable was extracted into Task 3. Exercised end-to-end in Task 7.

- [ ] **Step 1: Import the table**

In `src/app/holiday-actions.ts`, change the schema import:

```ts
import { dayEntries, phHolidays } from "@/db/schema";
```

and add `and`-compatible operators to the existing drizzle import — it already imports `and`, `eq`, `gte`, `lte`, `min`, so nothing new is needed there.

- [ ] **Step 2: Write the reference rows**

In `importHolidays`, immediately after the existing `if (plan.toInsert.length > 0) { ... }` block and **before** `revalidatePath("/")`, insert:

```ts
  if (plan.reference.length > 0) {
    // Replace the year's reference rows rather than upserting them, so a
    // re-import is authoritative: when a tentative Islamic date shifts —
    // Eid al-Fitr moving off 2027-03-10 — the stale row goes instead of
    // accumulating beside the new one.
    //
    // neon-http has no transaction, so a failure between these two statements
    // leaves the year's reference rows missing. Accepted: the table is
    // display-only, nothing computed reads it, and re-running the import
    // restores it.
    //
    // The guard above cannot be false when the action reaches here — toInsert,
    // alreadyMarked and beforeRecord all derive from the same nationwide,
    // in-range set that fills `reference`, so an empty `reference` means all
    // three are zero and the out-of-range error returned further up. It is
    // written anyway, because Drizzle throws on an empty values array and that
    // invariant should not be load-bearing at a distance.
    await db
      .delete(phHolidays)
      .where(and(gte(phHolidays.date, startDate), lte(phHolidays.date, endDate)));
    await db
      .insert(phHolidays)
      .values(plan.reference.map((h) => ({ date: h.date, name: h.name })));
  }
```

- [ ] **Step 3: Type-check, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`

Expected: no output from `tsc`, eslint silent, and `Test Files  4 passed (4)`,
`Tests  262 passed (262)`.

- [ ] **Step 4: Commit**

```bash
git add src/app/holiday-actions.ts
git commit -m "feat: store the imported year's holiday calendar"
```

---

## Task 5: the month reference list

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/calendar.tsx`

- [ ] **Step 1: Query `ph_holidays` in `page.tsx`**

Add `phHolidays` to the schema import:

```ts
import { dayEntries, phHolidays, rtoTargets, wfhMandates } from "@/db/schema";
```

Then add a third query to the second `Promise.all` (the one destructured as `const [rows, mandates] = await Promise.all([...])`, at `src/app/page.tsx:84`). Change the destructuring and append the query as the third element:

```ts
  const [rows, mandates, monthHolidays] = await Promise.all([
```

then add this as a third array element, after the mandates query — the array's existing closing
`]);` stays where it is:

```ts
    // The displayed month only. This is the PH calendar, not the user's record:
    // it holds weekend holidays, is not user-scoped, and nothing computed reads
    // it — the footnote is its only consumer.
    db
      .select({ date: phHolidays.date, name: phHolidays.name })
      .from(phHolidays)
      .where(
        and(
          gte(phHolidays.date, `${monthKey}-01`),
          lte(phHolidays.date, `${monthKey}-31`)
        )
      ),
```

`and`, `gte` and `lte` are already imported at the top of `page.tsx`.

- [ ] **Step 2: Delete `monthNotes` and pass the holidays instead**

Delete this whole block from `src/app/page.tsx` (it begins around line 137, with the comment starting "Every note in the displayed month"):

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

Then in the `<Calendar>` element, replace the `notes` prop:

```tsx
        initialEntries={monthEntries}
        holidays={monthHolidays}
```

Leave `note: dayEntries.note` in the `day_entries` select. It still records which rows the import wrote — provenance a hand-tap has no way to carry — and dropping the column would need a destructive migration for no gain.

- [ ] **Step 3: Swap the prop in `Calendar`**

In `src/components/calendar.tsx`, replace `notes` in the destructuring and the props type:

```tsx
export function Calendar({
  monthKey,
  initialEntries,
  holidays,
  targetPercent,
  mandates,
  fyBaseline,
}: {
  monthKey: string;
  initialEntries: Entries;
  /**
   * The PH holiday calendar for this month, weekend holidays included. A list
   * rather than a richer `Entries`: that type is `Record<string, DayStatus>`
   * throughout `rto.ts` and every arithmetic function takes it, so widening it
   * would touch all of them to carry data none of them read.
   */
  holidays: { date: string; name: string }[];
  targetPercent: number;
  mandates: WfhMandate[];
  fyBaseline: FyBaseline | null;
}) {
```

- [ ] **Step 4: Derive the annotated list**

Replace the `namedHolidays` block (at `src/components/calendar.tsx:124-129`, the comment beginning "Filtered against live `entries`") with:

```tsx
  // Every holiday the month has, annotated only where the day is *still
  // eligible* — that is, where the listed holiday is not actually excluding it.
  // `isEligible` excludes a day when it is mandated or its status is `leave` or
  // `holiday`, so a leave day needs no annotation: it is already out of the
  // pool, and saying "you marked leave" would imply it counts. Computed from
  // live `entries`, so a tap updates the annotation on the same tap.
  const monthHolidays = [...holidays]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, name }) => {
      if (isWeekend(date)) {
        const [y, m, d] = date.split("-").map(Number);
        const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        return { date, name, note: day === 6 ? "(Sat)" : "(Sun)" };
      }
      if (!isEligible(date, entries, mandates)) return { date, name, note: null };
      return {
        date,
        name,
        note:
          entries[date] === "office" ? "(you marked office)" : "(not marked)",
      };
    });
```

- [ ] **Step 5: Render it**

Replace the whole `{namedHolidays.length > 0 && ( ... )}` block (at `src/components/calendar.tsx:288-302`) with:

```tsx
      {monthHolidays.length > 0 && (
        <div className="space-y-1 border-l-2 border-fade pl-3">
          <p className="font-mono text-[10px] tracking-widest text-fade uppercase">
            Holidays
          </p>
          {monthHolidays.map(({ date, name, note }) => (
            <p key={date} className="font-mono text-xs text-fade">
              <span className="mr-2 inline-block w-4 text-right tabular-nums">
                {Number(date.slice(-2))}
              </span>
              {name}
              {note && <span className="ml-2 text-fade/70">{note}</span>}
            </p>
          ))}
        </div>
      )}
```

- [ ] **Step 6: Type-check, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`

Expected: no output from `tsc`, eslint silent, and `Tests  262 passed (262)`. The selected `note`
column now has no reader; that is deliberate and neither `tsc` nor eslint flags an unused object
property, so nothing should complain about it.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/components/calendar.tsx
git commit -m "feat: list the month's whole holiday calendar under the grid"
```

---

## Task 6: documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update `CLAUDE.md`**

In the **Architecture** section, find the paragraph beginning `` `parseHolidayIcs` keeps only events whose ICS `DESCRIPTION` begins `Public holiday`. `` and append to it:

```markdown
A second allowlist, `NATIONWIDE_HOLIDAYS`, decides which of those are non-working
*nationwide*: the feed carries no such field — every event is `CLASS:PUBLIC` and
`DESCRIPTION` takes only two values — so the judgement lives in code. It drops the BARMM-only
days (Maulid un-Nabi, Lailatul Isra Wal Mi Raj, Amun Jadid) and the second Eid day
(`Eid al-Adha Holiday`), which is a second day rather than a weekend substitute — unlike
`Day off for X`, which is kept. Both allowlists fail the same way on purpose: an unknown name
is dropped, leaving the day eligible and the requirement *higher*, where a denylist would mark
it and quietly lower the requirement.
```

Then replace the paragraph beginning `` `day_entries.note` survives a status change and dies with the row `` with:

```markdown
**`ph_holidays` is the calendar; `day_entries` is the record.** The import writes both: every
nationwide holiday of the year — **weekends included, and not clamped** — to the global
`ph_holidays` table, and only the eligible weekdays to `day_entries`. Nothing computed reads
`ph_holidays`; it feeds the month footnote alone, which is what keeps a tap beating the feed.
It is unclamped safely because `fyWindowStart` derives its window from `day_entries` only.
The import replaces the year's reference rows rather than upserting them, so a shifted
tentative date does not accumulate a stale row beside the new one.

The footnote lists every holiday the month has, annotating an entry only where the day is
**still eligible** — `isEligible` already excludes mandated days and `leave` as well as
`holiday`, so annotating a leave day would imply it counts when it does not.

`day_entries.note` is still written and now has no reader. It records which rows the import
wrote — provenance a hand-tap cannot carry — and dropping it would need a destructive
migration under the expand-then-contract rule for no gain.
```

Then in the **Data flow** section, find `` a `notes` map of every note in that month whatever the row's status, and the `FyBaseline` `` and replace that clause with:

```markdown
the month's `ph_holidays` rows, and the `FyBaseline`
```

- [ ] **Step 2: Update `docs/architecture.md`**

Under **Data model**, after the `wfh_mandates` block, add:

```
ph_holidays
  date  text  PRIMARY KEY  'YYYY-MM-DD'
  name  text  imported holiday's name, display only
  (global — not per-user; holds weekend dates, which day_entries never does)
```

Under **Computation rules**, replace the bullet reading `- Imported public holidays need no rule of their own: they are `holiday` rows in `day_entries`, already out of the eligible pool, and a tap overwrites them` with:

```markdown
- Imported public holidays need no rule of their own: the nationwide ones are `holiday` rows
  in `day_entries`, already out of the eligible pool, and a tap overwrites them. `ph_holidays`
  is display-only and no rule reads it
```

Under **Data flow**, replace the paragraph beginning `The settings page can import Philippine public holidays for one financial year` with:

```markdown
The settings page can import Philippine public holidays for one financial year: it fetches
Google's public PH holiday ICS feed, keeps events described as public holidays whose name is on
the `NATIONWIDE_HOLIDAYS` allowlist — the feed cannot distinguish a nationwide holiday from a
BARMM-only one — and plans the write with `planHolidayImport`. That returns two lists: the
weekday holidays to add to `day_entries`, which never overwrite an existing row and never
predate the user's first recorded day, so the import cannot move the FY window's start; and the
year's whole calendar for `ph_holidays`, weekends included and unclamped, which the month
footnote renders. Both are written, and `/` and `/settings` are revalidated.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/architecture.md
git commit -m "docs: record the nationwide allowlist and the reference calendar"
```

---

## Task 7: full verification

**Files:** none — this task only runs things.

- [ ] **Step 1: Suite, linter, build**

Run: `make test && make lint && npm run build`

Expected: `Test Files  4 passed (4)`, `Tests  262 passed (262)`, eslint silent, and a build with no
type errors. The build is what type-checks `page.tsx` and `calendar.tsx`, which have no unit tests.

- [ ] **Step 2: Verify the migration is recorded**

Run: `npm run db:check && git status --short && ls drizzle/*.sql`

Expected: the journal validates, the tree is clean, and three files are present: `0000_*.sql`, `0001_*.sql`, `0002_*.sql`.

- [ ] **Step 3: Exercise it against the dev branch**

Run `npm run dev`, sign in, go to `/settings`.

1. Import **FY2027**. The summary counts only nationwide holidays now, so expect a lower `marked` total than the previous run reported.
2. Go to `/?m=2026-08`. Expected: the footnote lists **21 Ninoy Aquino Day** and **31 National Heroes Day**. **26 Maulid un-Nabi must not be listed.**
3. 26 August is still a `holiday` cell from the earlier import — this change does not retract rows. Tap it once (holiday → WFH). Expected: the August requirement rises by one, and the cell clears.
4. Go to `/?m=2026-11`. Expected three entries, the Sunday one annotated:

   ```
   HOLIDAYS
    1  All Saints' Day  (Sun)
    2  All Souls' Day
   30  Bonifacio Day
   ```
5. Tap **2 November** once (holiday → WFH). Expected: it stays listed, now annotated `(not marked)`, and the month requirement rises by one.
6. Tap it again (WFH → office). Expected: the annotation becomes `(you marked office)`.
7. Tap twice more, back to `holiday`. Expected: the annotation disappears — and unlike before, the **name is still there**, because it comes from `ph_holidays` and not from the deleted row's note.
8. Re-import FY2027. Expected: no duplicate rows, no error.

- [ ] **Step 4: Confirm the clamp still holds and the calendar is unclamped**

Import **FY2026** (Aug 2025 – Jul 2026) on a record whose earliest entry is 2026-07-06.

Expected: the notice includes a `before your record starts` clause. Then check `/?m=2025-08` — expected: **no** holiday cells marked, but the footnote **does** list that month's holidays. That is the difference between the two lists working as designed: the record is clamped, the calendar is not.

Confirm the window start did not move — the FY block on `/?m=2026-07` should still count from July 2026, not August 2025.

- [ ] **Step 5: Final commit if anything drifted**

```bash
git status --short
```

Expected: clean. `next dev` rewrites the `AGENTS.md` block; if it shows as modified, commit it with the work rather than reverting it — reverting only re-creates the change.

---

## Deferred

Named so nobody adds them mid-plan:

- **Retracting already-imported regional holidays.** The import must not delete `day_entries` rows: it cannot tell a row it wrote from one the user set by hand.
- **Backfilling `ph_holidays` for years imported before this change.** Re-importing is one click per year.
- **Employment start date** — still the largest known gap.
- **Any country but PH**, and any per-user country or allowlist setting.
- **Distinguishing regular holidays from special non-working days in the UI.** Both leave the eligible pool identically.

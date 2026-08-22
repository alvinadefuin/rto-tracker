# Financial-Year Carryover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Judge RTO compliance cumulatively across a financial year that runs August to July — so a surplus in one month settles a shortfall in another and the slate wipes each July — and let target percentages be entered with the same date picker the WFH mandates use.

**Architecture:** All new logic is pure functions in `src/lib/rto.ts`, unit-testable in the existing node environment. The financial year is derived from the **displayed** month, never from the clock, so server rendering stays timezone-independent. `page.tsx` widens its queries from one month to the FY-to-date window and hands the client an `FyContext` holding **two numbers** — office days and an un-rounded `weightedEligible` sum for the months before the displayed one — so `Calendar` can recompute FY figures locally after every tap without shipping earlier months' entries. The single `Math.ceil` lands on the FY total, not on each month. `rto_targets` keeps storing `YYYY-MM`; only the form widget and one normalisation step change, so there is no migration.

**Tech Stack:** Next.js (App Router), React, Drizzle ORM, Neon Postgres, Auth.js v5, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-financial-year-carryover-design.md`

---

## Before you start

Read `CLAUDE.md` and `AGENTS.md` in the repo root. Five invariants govern every task here:

1. **Dates are text, never `Date`.** Day keys are `YYYY-MM-DD`, month keys are `YYYY-MM`. Both are zero-padded and fixed-width, so `<=` and `>=` on the strings are correct calendar comparisons. Never parse a date string with `new Date("2026-08-12")` — that goes through the local timezone and shifts the day. `new Date(Date.UTC(y, m - 1, d))` built from split integer components is fine.
2. **`src/lib/rto.ts` is pure and isomorphic.** Both the server (`page.tsx`) and the client (`calendar.tsx`) import from it. It must not touch the database, the network, or the clock. `financialYearOf` takes a month key precisely so it never reads `new Date()`.
3. **The FY comes from the displayed month.** Not from today. Browsing July 2027 must show FY2027 even in August 2026. This is both a feature (you can review a finished year) and the reason SSR output stays timezone-independent.
4. **`weightedEligible` is deliberately un-rounded.** It is a sum of `eligibleDays × percent` in *percent-points*. Divide by 100 exactly once, at the very end, in `computeFyStats`. Rounding per month instead costs the user about six office days a year. Do not "simplify" it into a per-month `requiredDays` sum.
5. **`rto_targets` still stores `YYYY-MM`.** The form posts whole dates now; `toMonthKey` truncates. Nothing downstream of the action ever sees a day.

Confirm a green baseline before touching anything:

```bash
npm test
```

Expected: `Test Files  3 passed (3)`, `Tests  124 passed (124)`.

No task in this plan changes `src/db/schema.ts`, so no `db:generate` and no `db:migrate` run anywhere. If you find yourself editing the schema, stop — you have gone off-plan.

**Calendar facts asserted below.** These were verified against the real calendar; do not "correct" them.

| Month | Weekdays |
|---|---|
| Aug 2026 | 21 |
| Sep 2026 | 22 |
| Oct 2026 | 22 |
| Jul 2027 | 22 |
| FY2027 total (Aug 2026 – Jul 2027) | 260, so `ceil(260 × 40 / 100) = 104` |

**Worked example threaded through Tasks 6–8.** August and September 2026 fully eligible at 40% give `weightedEligible = (21 + 22) × 40 = 1720`. Add a fully eligible October at 40% (`22 × 40 = 880`) for 2600 percent-points, so the year owes `ceil(26.0) = 26` office days through October. Summing monthly round-ups would owe 27. That one-day difference is the entire point of the design, and Task 7 asserts it.

---

## File Structure

**Create:**
- `docs/decisions/0005-financial-year-carryover.md` — ADR recording the annual-assessment problem, single-`ceil` rounding, the displayed-month window, and the tracking-start floor.

**Modify:**
- `src/lib/rto.ts` — all new pure logic: `toMonthKey`, `financialYearOf`, `financialYearBounds`, `shiftMonthKey`, `monthsBetween`, `mandateTouchesMonth`, `aggregateMonths`, `computeFyStats`, `fyVerdict`, plus the `MonthsAggregate` / `FyContext` / `FyStats` types.
- `src/lib/rto.test.ts` — one new `describe` block per function.
- `src/components/period-form.tsx` — `type="month"` inputs become `type="date"`.
- `src/app/settings-actions.ts` — normalise through `toMonthKey`, delete its local `MONTH_RE`.
- `src/app/page.tsx` — FY window derivation, widened `day_entries` and `wfh_mandates` queries, `fyContext` prop; drops its local `MONTH_RE` and `shiftMonth` in favour of `toMonthKey` and `shiftMonthKey`.
- `src/components/calendar.tsx` — accepts `fyContext`, recomputes `FyStats` locally.
- `src/components/stats.tsx` — splits into a month block and an FY block.
- `CLAUDE.md`, `docs/architecture.md` — document the FY rules.

**Not touched:** `src/db/schema.ts`, `drizzle/`, `src/app/actions.ts`, `src/components/period-row.tsx`, `src/components/mandate-form.tsx`.

One design decision differs from the spec: the eight-branch verdict copy lives in `rto.ts` as `fyVerdict`, not inline in `stats.tsx`. `rto.ts` already owns the display formatters (`formatMonth`, `formatPeriodRange`, `formatMandateRange`), and Vitest runs in a `node` environment with no DOM, so copy in a component cannot be tested at all. The spec called that table the riskiest surface in the change; this is what makes it assertable.

---

## Task 1: `toMonthKey` — accept a day, store a month

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("toMonthKey", () => {
  it("passes a month key through unchanged", () => {
    expect(toMonthKey("2026-08")).toBe("2026-08");
  });

  it("truncates a day key to its month", () => {
    expect(toMonthKey("2026-08-12")).toBe("2026-08");
    expect(toMonthKey("2026-08-01")).toBe("2026-08");
    expect(toMonthKey("2026-12-31")).toBe("2026-12");
  });

  it("rejects an impossible day rather than truncating it", () => {
    // The regex alone would admit this; isValidDateKey is what catches it.
    expect(toMonthKey("2026-02-30")).toBeNull();
  });

  it("rejects a bad month, junk, and empty input", () => {
    expect(toMonthKey("2026-13")).toBeNull();
    expect(toMonthKey("2026-00")).toBeNull();
    expect(toMonthKey("26-08")).toBeNull();
    expect(toMonthKey("august")).toBeNull();
    expect(toMonthKey("")).toBeNull();
  });
});
```

Add `toMonthKey` to the import block at the top of the file.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/lib/rto.test.ts -t "toMonthKey"
```

Expected: failure. TypeScript/Vitest reports that `toMonthKey` is not exported from `./rto`.

- [ ] **Step 3: Implement it**

In `src/lib/rto.ts`, immediately after the existing `isValidDateKey` function:

```ts
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Month key for either a `YYYY-MM` key or a `YYYY-MM-DD` day, or null when the
 * value is neither. Accepting both is what lets the settings form post whole
 * dates from a date picker while `rto_targets` keeps storing months.
 *
 * This is now the only month-key validator in the codebase: `page.tsx` and
 * `settings-actions.ts` each had their own copy of the regex above.
 */
export function toMonthKey(value: string): string | null {
  if (MONTH_KEY_RE.test(value)) return value;
  if (isValidDateKey(value)) return value.slice(0, 7);
  return null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run src/lib/rto.test.ts -t "toMonthKey"
```

Expected: `Tests  4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: normalise a day or month key to a month key"
```

---

## Task 2: date pickers for target periods

**Files:**
- Modify: `src/components/period-form.tsx`
- Modify: `src/app/settings-actions.ts`

No unit test: Vitest runs in a `node` environment with no DOM, and `settings-actions.ts` is a `"use server"` module that opens a database connection on import. The logic worth asserting was extracted into `toMonthKey` and is covered by Task 1. This task is verified by the type checker and by hand.

- [ ] **Step 1: Switch both inputs to date pickers**

In `src/components/period-form.tsx`, change the two inputs. The `name` attributes stay `startMonth` and `endMonth` — the server action is their only reader, and it normalises.

```tsx
          <input
            type="date"
            name="startMonth"
            required
            defaultValue={initial ? `${initial.startMonth}-01` : undefined}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          />
```

```tsx
          <input
            type="date"
            name="endMonth"
            defaultValue={initial?.endMonth ? `${initial.endMonth}-01` : ""}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          />
```

Stored values are month keys, so `-01` is appended to give the picker a real date to seed from. `initial?.endMonth ? … : ""` is required rather than `?? ""`: an ongoing period has `endMonth === null`, and `` `${null}-01` `` would render the string `"null-01"`.

- [ ] **Step 2: Update the hint copy**

Replace the paragraph below the fields:

```tsx
      <p className="text-xs text-fade">
        Any day in the month works — periods run in whole months. Leave{" "}
        <span className="font-mono">To</span> blank for an ongoing period.
      </p>
```

- [ ] **Step 3: Normalise in the action**

In `src/app/settings-actions.ts`, delete the `const MONTH_RE = …` line, add `toMonthKey` to the existing `@/lib/rto` import, and replace the first two validation blocks of `parse`:

```ts
function parse(
  formData: FormData
): { ok: true; period: TargetPeriod } | { ok: false; error: string } {
  const startMonth = toMonthKey(String(formData.get("startMonth") ?? ""));
  const rawEnd = String(formData.get("endMonth") ?? "").trim();
  const endMonth = rawEnd === "" ? null : toMonthKey(rawEnd);
  const percent = Number(formData.get("percent"));

  if (startMonth === null) {
    return { ok: false, error: "Start month must be a valid date." };
  }
  if (rawEnd !== "" && endMonth === null) {
    return { ok: false, error: "End month must be a valid date, or blank." };
  }
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: "Percent must be a whole number from 0 to 100." };
  }
  if (endMonth !== null && endMonth < startMonth) {
    return { ok: false, error: "End month cannot be before the start month." };
  }
  return { ok: true, period: { startMonth, endMonth, percent } };
}
```

Two things to get right. The blank-means-ongoing check runs *before* normalisation, so an empty `To` stays `null` and never reaches `toMonthKey`. And the guard is `rawEnd !== "" && endMonth === null`, not `endMonth === null` — the latter would reject every ongoing period.

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit && make lint
```

Expected: no output from `tsc`, and `✔ No ESLint warnings or errors`.

- [ ] **Step 5: Verify by hand**

```bash
npm run dev
```

At `http://localhost:3000/settings`:

1. Both period fields show a date picker, matching the mandate form below them.
2. Add a period: pick any mid-month day (say the 12th), enter `60`, submit. The row renders as a month range — `Aug 2026 – ongoing`, not `12 Aug 2026`.
3. Press Edit on that row. The From field is populated with the 1st of the month.
4. Add a second period overlapping the first. Expected: `Overlaps an existing period (…)`, proving normalisation happens before the overlap check.
5. Delete the test periods.

- [ ] **Step 6: Commit**

```bash
git add src/components/period-form.tsx src/app/settings-actions.ts
git commit -m "feat: pick target period bounds with a date picker"
```

---

## Task 3: `financialYearOf` and `financialYearBounds`

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("financialYearOf", () => {
  it("names the FY for the calendar year it ends in", () => {
    // FY2027 runs Aug 2026 - Jul 2027.
    expect(financialYearOf("2026-08")).toBe(2027);
    expect(financialYearOf("2026-12")).toBe(2027);
    expect(financialYearOf("2027-01")).toBe(2027);
    expect(financialYearOf("2027-07")).toBe(2027);
  });

  it("flips at the July/August boundary", () => {
    expect(financialYearOf("2026-07")).toBe(2026);
    expect(financialYearOf("2026-08")).toBe(2027);
    expect(financialYearOf("2027-07")).toBe(2027);
    expect(financialYearOf("2027-08")).toBe(2028);
  });
});

describe("financialYearBounds", () => {
  it("returns August of the previous year through July", () => {
    expect(financialYearBounds(2027)).toEqual({
      startMonth: "2026-08",
      endMonth: "2027-07",
    });
  });

  it("round-trips with financialYearOf at both ends", () => {
    const { startMonth, endMonth } = financialYearBounds(2027);
    expect(financialYearOf(startMonth)).toBe(2027);
    expect(financialYearOf(endMonth)).toBe(2027);
    // One month either side belongs to the neighbouring years.
    expect(financialYearOf("2026-07")).toBe(2026);
    expect(financialYearOf("2027-08")).toBe(2028);
  });
});
```

Add `financialYearOf` and `financialYearBounds` to the import block.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/lib/rto.test.ts -t "financialYear"
```

Expected: failure — `financialYearOf` is not exported.

- [ ] **Step 3: Implement it**

In `src/lib/rto.ts`, in a new section after the `TargetPeriod` helpers:

```ts
/**
 * Financial years start in August. Hardcoded rather than configurable: one
 * employer, one calendar. The maths below assumes a start month after January,
 * which August is.
 */
const FY_START_MONTH = 8;

/**
 * Financial year containing `monthKey`, named for the calendar year it **ends**
 * in — FY2027 runs Aug 2026 through Jul 2027.
 *
 * Takes a month key rather than reading the clock, deliberately: every caller
 * derives the year from the month on screen, which is what keeps server output
 * timezone-independent.
 */
export function financialYearOf(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return month >= FY_START_MONTH ? year + 1 : year;
}

/** First and last month of `fy`, inclusive. */
export function financialYearBounds(fy: number): {
  startMonth: string;
  endMonth: string;
} {
  return {
    startMonth: `${fy - 1}-${pad(FY_START_MONTH)}`,
    endMonth: `${fy}-${pad(FY_START_MONTH - 1)}`,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run src/lib/rto.test.ts -t "financialYear"
```

Expected: `Tests  4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: derive the financial year from a month key"
```

---

## Task 4: `shiftMonthKey` and `monthsBetween`

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("shiftMonthKey", () => {
  it("steps forward and back within a year", () => {
    expect(shiftMonthKey("2026-08", 1)).toBe("2026-09");
    expect(shiftMonthKey("2026-08", -1)).toBe("2026-07");
    expect(shiftMonthKey("2026-08", 0)).toBe("2026-08");
  });

  it("crosses year boundaries in both directions", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("handles multi-year shifts", () => {
    expect(shiftMonthKey("2026-03", -14)).toBe("2025-01");
    expect(shiftMonthKey("2026-03", 24)).toBe("2028-03");
  });

  it("keeps months zero-padded so string comparison stays valid", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-12", 9)).toBe("2027-09");
  });
});

describe("monthsBetween", () => {
  it("walks inclusively across a year boundary", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("returns a single month when start equals end", () => {
    expect(monthsBetween("2026-08", "2026-08")).toEqual(["2026-08"]);
  });

  it("returns an empty list when start is after end", () => {
    expect(monthsBetween("2026-09", "2026-08")).toEqual([]);
  });

  it("covers a whole financial year in twelve months", () => {
    const { startMonth, endMonth } = financialYearBounds(2027);
    const months = monthsBetween(startMonth, endMonth);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-08");
    expect(months[11]).toBe("2027-07");
  });
});
```

Add `shiftMonthKey` and `monthsBetween` to the import block.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/lib/rto.test.ts -t "shiftMonthKey"
```

Expected: failure — `shiftMonthKey` is not exported.

- [ ] **Step 3: Implement it**

In `src/lib/rto.ts`, next to the FY helpers:

```ts
/**
 * `monthKey` shifted by `delta` months. Integer month math on a year*12 index —
 * no Date is constructed, so no timezone can intervene.
 */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/**
 * Inclusive `YYYY-MM` walk from `start` to `end`; `[]` when `start > end`.
 * The bound is a string comparison, which is exact for fixed-width keys.
 */
export function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  for (let key = start; key <= end; key = shiftMonthKey(key, 1)) {
    months.push(key);
  }
  return months;
}
```

- [ ] **Step 4: Run both tests and watch them pass**

```bash
npx vitest run src/lib/rto.test.ts -t "shiftMonthKey" && npx vitest run src/lib/rto.test.ts -t "monthsBetween"
```

Expected: `Tests  4 passed` then `Tests  4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: month-key arithmetic for walking a financial year"
```

---

## Task 5: `mandateTouchesMonth`

The mandates query is about to widen from one month to the whole FY window, so the page header needs a way to filter back down to the displayed month.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("mandateTouchesMonth", () => {
  it("is true for a mandate contained in the month", () => {
    const m: WfhMandate = { startDate: "2026-08-12", endDate: "2026-08-20" };
    expect(mandateTouchesMonth(m, "2026-08")).toBe(true);
  });

  it("is true for a mandate spanning into the month from either side", () => {
    const before: WfhMandate = { startDate: "2026-07-28", endDate: "2026-08-03" };
    const after: WfhMandate = { startDate: "2026-08-28", endDate: "2026-09-04" };
    expect(mandateTouchesMonth(before, "2026-08")).toBe(true);
    expect(mandateTouchesMonth(after, "2026-08")).toBe(true);
  });

  it("is true on the first and last day of the month", () => {
    const first: WfhMandate = { startDate: "2026-08-01", endDate: "2026-08-01" };
    const last: WfhMandate = { startDate: "2026-08-31", endDate: "2026-08-31" };
    expect(mandateTouchesMonth(first, "2026-08")).toBe(true);
    expect(mandateTouchesMonth(last, "2026-08")).toBe(true);
  });

  it("is false for a mandate wholly before or after the month", () => {
    const before: WfhMandate = { startDate: "2026-07-01", endDate: "2026-07-31" };
    const after: WfhMandate = { startDate: "2026-09-01", endDate: "2026-09-30" };
    expect(mandateTouchesMonth(before, "2026-08")).toBe(false);
    expect(mandateTouchesMonth(after, "2026-08")).toBe(false);
  });

  it("treats a null endDate as reaching every later month", () => {
    const open: WfhMandate = { startDate: "2026-08-12", endDate: null };
    expect(mandateTouchesMonth(open, "2026-08")).toBe(true);
    expect(mandateTouchesMonth(open, "2027-03")).toBe(true);
    expect(mandateTouchesMonth(open, "2026-07")).toBe(false);
  });

  it("handles a short month, where the -31 upper bound is not a real day", () => {
    const feb: WfhMandate = { startDate: "2026-02-27", endDate: "2026-02-28" };
    expect(mandateTouchesMonth(feb, "2026-02")).toBe(true);
  });
});
```

Add `mandateTouchesMonth` to the import block.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/lib/rto.test.ts -t "mandateTouchesMonth"
```

Expected: failure — `mandateTouchesMonth` is not exported.

- [ ] **Step 3: Implement it**

In `src/lib/rto.ts`, after `mandatesOverlap`:

```ts
/**
 * True when `mandate` covers any day of `monthKey` (YYYY-MM). The `-31` upper
 * bound is the same trick the page queries use: against a fixed-width key, a
 * bound past the end of a short month is harmless, because no stored day can
 * fall between the real month end and the 31st.
 */
export function mandateTouchesMonth(
  mandate: WfhMandate,
  monthKey: string
): boolean {
  return (
    mandate.startDate <= `${monthKey}-31` &&
    `${monthKey}-01` <= (mandate.endDate ?? OPEN_ENDED_DATE)
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run src/lib/rto.test.ts -t "mandateTouchesMonth"
```

Expected: `Tests  6 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: test whether a mandate touches a given month"
```

---
## Task 6: `aggregateMonths` — roll up the months before the displayed one

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("aggregateMonths", () => {
  // Aug 2026 has 21 weekdays, Sep 2026 has 22.
  const AUG_SEP = ["2026-08", "2026-09"];

  it("sums weighted eligible days at the default rate", () => {
    expect(aggregateMonths(AUG_SEP, {}, [], [])).toEqual({
      officeDays: 0,
      weightedEligible: (21 + 22) * 40,
    });
  });

  it("resolves the percentage per month, not once for the window", () => {
    const periods: TargetPeriod[] = [
      { startMonth: "2026-09", endMonth: "2026-09", percent: 60 },
    ];
    // August falls outside the period and keeps the 40% default.
    expect(aggregateMonths(AUG_SEP, {}, periods, []).weightedEligible).toBe(
      21 * 40 + 22 * 60
    );
  });

  it("counts office days across the whole window", () => {
    const entries: Entries = {
      "2026-08-03": "office", // Mon
      "2026-08-04": "office", // Tue
      "2026-09-01": "office", // Tue
    };
    expect(aggregateMonths(AUG_SEP, entries, [], []).officeDays).toBe(3);
  });

  it("drops leave and holiday days from the weighted total", () => {
    const entries: Entries = {
      "2026-08-05": "leave", // Wed
      "2026-09-01": "holiday", // Tue
    };
    expect(aggregateMonths(AUG_SEP, entries, [], []).weightedEligible).toBe(
      20 * 40 + 21 * 40
    );
  });

  it("contributes nothing for a fully mandated month", () => {
    const mandates: WfhMandate[] = [
      { startDate: "2026-08-01", endDate: "2026-08-31" },
    ];
    // An office stamp inside the mandate is still excluded, exactly as
    // computeMonthStats excludes it.
    const entries: Entries = { "2026-08-03": "office" };
    expect(aggregateMonths(AUG_SEP, entries, [], mandates)).toEqual({
      officeDays: 0,
      weightedEligible: 22 * 40,
    });
  });

  it("returns zeros for an empty month list", () => {
    expect(aggregateMonths([], {}, [], [])).toEqual({
      officeDays: 0,
      weightedEligible: 0,
    });
  });
});
```

Add `aggregateMonths` to the import block. `Entries`, `TargetPeriod` and `WfhMandate` are already imported as types.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/lib/rto.test.ts -t "aggregateMonths"
```

Expected: failure — `aggregateMonths` is not exported.

- [ ] **Step 3: Implement it**

In `src/lib/rto.ts`, after `computeMonthStats` (it calls both `computeMonthStats` and `resolvePercent`, so it belongs below them):

```ts
export interface MonthsAggregate {
  officeDays: number;
  /**
   * Σ (eligibleDays × targetPercent) across the months, in percent-points and
   * deliberately **un-rounded**. Dividing by 100 exactly once, at the end, in
   * computeFyStats is the whole point: it is what makes a 260-weekday year at
   * 40% owe 104 days rather than the ~110 that twelve monthly round-ups cost.
   */
  weightedEligible: number;
}

/**
 * Roll up whole months. Each month resolves its own percentage, so a rate
 * change part-way through the window is honoured.
 *
 * Goes through computeMonthStats even though the weeks array it builds is
 * thrown away: eleven months of throwaway arrays once per render is nothing,
 * and it keeps exactly one definition of an eligible day. A second, leaner
 * counting path is how the two drift apart.
 */
export function aggregateMonths(
  months: string[],
  entries: Entries,
  periods: TargetPeriod[],
  mandates: WfhMandate[]
): MonthsAggregate {
  let officeDays = 0;
  let weightedEligible = 0;
  for (const monthKey of months) {
    const [year, month] = monthKey.split("-").map(Number);
    const percent = resolvePercent(monthKey, periods);
    const stats = computeMonthStats(year, month, entries, percent, mandates);
    officeDays += stats.officeDays;
    weightedEligible += stats.eligibleDays * percent;
  }
  return { officeDays, weightedEligible };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run src/lib/rto.test.ts -t "aggregateMonths"
```

Expected: `Tests  6 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: aggregate office and weighted eligible days over months"
```

---

## Task 7: `computeFyStats` — one ceil for the year

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("computeFyStats", () => {
  // Aug + Sep 2026 fully eligible at 40%: (21 + 22) * 40 = 1720 percent-points.
  const PRIOR_AUG_SEP: MonthsAggregate = {
    officeDays: 23,
    weightedEligible: 1720,
  };

  // Six office days in Oct 2026, all weekdays.
  const OCT_OFFICE: Entries = {
    "2026-10-01": "office",
    "2026-10-02": "office",
    "2026-10-05": "office",
    "2026-10-06": "office",
    "2026-10-07": "office",
    "2026-10-08": "office",
  };

  function octContext(prior: MonthsAggregate): FyContext {
    return {
      fy: 2027,
      monthKey: "2026-10",
      fyStartMonth: "2026-08",
      fyEndMonth: "2027-07",
      windowStartMonth: "2026-08",
      prior,
    };
  }

  it("rounds once on the FY total, not once per month", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats(octContext(PRIOR_AUG_SEP), october);
    // 1720 + 22*40 = 2600 percent-points -> exactly 26 days.
    expect(fy.cumulativeRequired).toBe(26);
    // Summing monthly ceils would owe 27: ceil(8.4)+ceil(8.8)+ceil(8.8).
    const monthlySum =
      Math.ceil((21 * 40) / 100) +
      Math.ceil((22 * 40) / 100) +
      Math.ceil((22 * 40) / 100);
    expect(monthlySum).toBe(27);
    expect(fy.cumulativeRequired).toBeLessThan(monthlySum);
  });

  it("adds the displayed month's office days to the prior window", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats(octContext(PRIOR_AUG_SEP), october);
    expect(fy.cumulativeOffice).toBe(29);
    expect(fy.balance).toBe(3);
    expect(fy.remainingNeeded).toBe(0);
    expect(fy.fy).toBe(2027);
  });

  it("carries a shortfall forward as days still owed", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats(
      octContext({ officeDays: 5, weightedEligible: 1720 }),
      october
    );
    expect(fy.cumulativeOffice).toBe(11);
    expect(fy.cumulativeRequired).toBe(26);
    expect(fy.balance).toBe(-15);
    expect(fy.remainingNeeded).toBe(15);
  });

  it("lets a banked surplus cover a whole month worked from home", () => {
    // 11 required against 20 stamped through June: 9 days banked.
    const prior: MonthsAggregate = { officeDays: 20, weightedEligible: 1100 };
    // Jul 2027 has 22 weekdays and nothing stamped.
    const july = computeMonthStats(2027, 7, {}, 40);
    const fy = computeFyStats(
      {
        fy: 2027,
        monthKey: "2027-07",
        fyStartMonth: "2026-08",
        fyEndMonth: "2027-07",
        windowStartMonth: "2026-08",
        prior,
      },
      july
    );
    expect(july.requiredDays).toBe(9); // the month alone still asks for 9
    expect(fy.cumulativeRequired).toBe(20); // 1100 + 880 = 1980 -> ceil 19.8
    expect(fy.cumulativeOffice).toBe(20);
    expect(fy.balance).toBe(0);
    expect(fy.remainingNeeded).toBe(0); // a whole month at home, still level
    expect(fy.isFinalMonth).toBe(true);
  });

  it("flags the final month only in July", () => {
    const june = computeMonthStats(2027, 6, {}, 40);
    const notFinal = computeFyStats(
      {
        fy: 2027,
        monthKey: "2027-06",
        fyStartMonth: "2026-08",
        fyEndMonth: "2027-07",
        windowStartMonth: "2026-08",
        prior: { officeDays: 0, weightedEligible: 0 },
      },
      june
    );
    expect(notFinal.isFinalMonth).toBe(false);
  });

  it("flags a partial window when tracking began mid-year", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const partial = computeFyStats(
      { ...octContext(PRIOR_AUG_SEP), windowStartMonth: "2026-09" },
      october
    );
    expect(partial.isPartialWindow).toBe(true);
    expect(partial.windowStartMonth).toBe("2026-09");
    expect(computeFyStats(octContext(PRIOR_AUG_SEP), october).isPartialWindow).toBe(
      false
    );
  });

  it("handles an all-mandated window without dividing by zero", () => {
    const mandates: WfhMandate[] = [
      { startDate: "2026-10-01", endDate: "2026-10-31" },
    ];
    const october = computeMonthStats(2026, 10, {}, 40, mandates);
    const fy = computeFyStats(
      octContext({ officeDays: 0, weightedEligible: 0 }),
      october
    );
    expect(fy.cumulativeRequired).toBe(0);
    expect(fy.cumulativeOffice).toBe(0);
    expect(fy.balance).toBe(0);
    expect(fy.remainingNeeded).toBe(0);
  });
});
```

Add `computeFyStats`, `type FyContext` and `type MonthsAggregate` to the import block.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/lib/rto.test.ts -t "computeFyStats"
```

Expected: failure — `computeFyStats` is not exported.

- [ ] **Step 3: Implement it**

In `src/lib/rto.ts`, after `aggregateMonths`:

```ts
export interface FyContext {
  fy: number;
  monthKey: string; // the displayed month, YYYY-MM
  fyStartMonth: string; // the FY's own first month
  fyEndMonth: string;
  /** fyStartMonth, or later when the record began mid-year. */
  windowStartMonth: string;
  /** Months from windowStartMonth up to, but not including, monthKey. */
  prior: MonthsAggregate;
}

export interface FyStats {
  fy: number;
  fyStartMonth: string;
  fyEndMonth: string;
  windowStartMonth: string;
  isPartialWindow: boolean; // windowStartMonth > fyStartMonth
  isFinalMonth: boolean; // monthKey === fyEndMonth
  cumulativeOffice: number;
  cumulativeRequired: number;
  balance: number; // office − required; negative means days are owed
  remainingNeeded: number; // max(0, −balance)
}

/**
 * Financial-year position through the displayed month, inclusive.
 *
 * The single Math.ceil here is the design: prior months contribute un-rounded
 * percent-points, the displayed month adds its own, and the year rounds up once.
 * Every field is derived from month keys and integers, so nothing consults the
 * clock and the client can recompute this after each tap.
 */
export function computeFyStats(ctx: FyContext, month: MonthStats): FyStats {
  const cumulativeOffice = ctx.prior.officeDays + month.officeDays;
  const weighted =
    ctx.prior.weightedEligible + month.eligibleDays * month.targetPercent;
  const cumulativeRequired = Math.ceil(weighted / 100);
  const balance = cumulativeOffice - cumulativeRequired;
  return {
    fy: ctx.fy,
    fyStartMonth: ctx.fyStartMonth,
    fyEndMonth: ctx.fyEndMonth,
    windowStartMonth: ctx.windowStartMonth,
    isPartialWindow: ctx.windowStartMonth > ctx.fyStartMonth,
    isFinalMonth: ctx.monthKey === ctx.fyEndMonth,
    cumulativeOffice,
    cumulativeRequired,
    balance,
    remainingNeeded: Math.max(0, -balance),
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run src/lib/rto.test.ts -t "computeFyStats"
```

Expected: `Tests  7 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: cumulative financial-year stats with one rounding step"
```

---

## Task 8: `fyVerdict` — the sentence that says what the year owes

Eight branches of copy. The spec calls this the surface most likely to feel wrong on screen, which is exactly why it is a tested pure function rather than JSX.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("fyVerdict", () => {
  function stats(overrides: Partial<FyStats> = {}): FyStats {
    return {
      fy: 2027,
      fyStartMonth: "2026-08",
      fyEndMonth: "2027-07",
      windowStartMonth: "2026-08",
      isPartialWindow: false,
      isFinalMonth: false,
      cumulativeOffice: 29,
      cumulativeRequired: 26,
      balance: 3,
      remainingNeeded: 0,
      ...overrides,
    };
  }

  it("says nothing was owed when the whole window was mandated", () => {
    expect(fyVerdict(stats({ cumulativeRequired: 0, balance: 0 }), 0)).toBe(
      "No requirement so far — every counted day was mandated WFH."
    );
  });

  it("declares the year met on a surplus in the final month", () => {
    expect(fyVerdict(stats({ isFinalMonth: true }), 0)).toBe(
      "3 days ahead — FY2027 met."
    );
  });

  it("says the surplus covers the month's remaining days", () => {
    expect(fyVerdict(stats(), 3)).toBe(
      "3 days ahead — this month's 3 remaining days are covered."
    );
  });

  it("banks a surplus when the month is already covered", () => {
    expect(fyVerdict(stats(), 0)).toBe(
      "3 days ahead — banked toward later months."
    );
  });

  it("reports an exactly met year in the final month", () => {
    expect(
      fyVerdict(stats({ balance: 0, isFinalMonth: true, cumulativeOffice: 26 }), 0)
    ).toBe("Level — FY2027 met exactly.");
  });

  it("reports being level mid-year", () => {
    expect(fyVerdict(stats({ balance: 0, cumulativeOffice: 26 }), 0)).toBe(
      "Level — no days banked."
    );
  });

  it("declares the year missed on a shortfall in the final month", () => {
    expect(
      fyVerdict(
        stats({ balance: -2, isFinalMonth: true, cumulativeOffice: 24 }),
        0
      )
    ).toBe("2 office days short — FY2027 not met.");
  });

  it("asks for the shortfall mid-year", () => {
    expect(
      fyVerdict(stats({ balance: -2, cumulativeOffice: 24, remainingNeeded: 2 }), 2)
    ).toBe("2 more office days needed to be level.");
  });

  it("uses singular forms for one day", () => {
    expect(fyVerdict(stats({ balance: 1, cumulativeOffice: 27 }), 1)).toBe(
      "1 day ahead — this month's 1 remaining day is covered."
    );
    expect(
      fyVerdict(stats({ balance: -1, cumulativeOffice: 25, remainingNeeded: 1 }), 1)
    ).toBe("1 more office day needed to be level.");
    expect(
      fyVerdict(
        stats({
          balance: -1,
          cumulativeOffice: 25,
          remainingNeeded: 1,
          isFinalMonth: true,
        }),
        1
      )
    ).toBe("1 office day short — FY2027 not met.");
  });
});
```

Add `fyVerdict` and `type FyStats` to the import block.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run src/lib/rto.test.ts -t "fyVerdict"
```

Expected: failure — `fyVerdict` is not exported.

- [ ] **Step 3: Implement it**

In `src/lib/rto.ts`, after `computeFyStats`:

```ts
const dayCount = (n: number) => (n === 1 ? "1 day" : `${n} days`);
const officeDayCount = (n: number) =>
  n === 1 ? "1 office day" : `${n} office days`;

/**
 * The one sentence saying what the financial year still owes. `monthRemaining`
 * is the displayed month's own shortfall, used only to say that a bank covers
 * it.
 *
 * Copy lives here rather than in the component because Vitest runs without a
 * DOM: eight branches are worth asserting, and in JSX they could not be.
 */
export function fyVerdict(fy: FyStats, monthRemaining: number): string {
  if (fy.cumulativeRequired === 0) {
    return "No requirement so far — every counted day was mandated WFH.";
  }

  if (fy.balance > 0) {
    const ahead = `${dayCount(fy.balance)} ahead`;
    if (fy.isFinalMonth) return `${ahead} — FY${fy.fy} met.`;
    if (monthRemaining > 0) {
      return `${ahead} — this month's ${monthRemaining} remaining ${
        monthRemaining === 1 ? "day is" : "days are"
      } covered.`;
    }
    return `${ahead} — banked toward later months.`;
  }

  if (fy.balance === 0) {
    return fy.isFinalMonth
      ? `Level — FY${fy.fy} met exactly.`
      : "Level — no days banked.";
  }

  const owed = -fy.balance;
  return fy.isFinalMonth
    ? `${officeDayCount(owed)} short — FY${fy.fy} not met.`
    : `${owed === 1 ? "1 more office day" : `${owed} more office days`} needed to be level.`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run src/lib/rto.test.ts -t "fyVerdict"
```

Expected: `Tests  9 passed`.

- [ ] **Step 5: Run the whole suite, then commit**

```bash
npm test
```

Expected: `Test Files  3 passed (3)`, `Tests  168 passed (168)`.

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: financial-year verdict copy as a tested pure function"
```

---
## Task 9: FY window in `page.tsx`

**Files:**
- Modify: `src/app/page.tsx`

Not unit-tested: it is an async server component that authenticates and queries the database, which the `node`-environment Vitest setup cannot exercise. Every decision it makes was extracted into the tested helpers above. Verified by the type checker and by hand.

- [ ] **Step 1: Replace the imports and drop the two local helpers**

The top of `src/app/page.tsx` becomes:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, isNull, lte, min, or } from "drizzle-orm";
import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { dayEntries, rtoTargets, wfhMandates } from "@/db/schema";
import {
  aggregateMonths,
  financialYearBounds,
  financialYearOf,
  formatDate,
  mandateTouchesMonth,
  monthsBetween,
  resolvePercent,
  shiftMonthKey,
  toMonthKey,
  type Entries,
  type FyContext,
} from "@/lib/rto";
import { Calendar } from "@/components/calendar";
```

Delete the `const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;` line and the whole `shiftMonth` function — `toMonthKey` and `shiftMonthKey` replace them. Keep `MONTH_NAMES`, `pad`, and `currentMonthKey` exactly as they are; `currentMonthKey` still uses `pad`, and it is the only clock read on the page (it picks the default month, nothing else).

- [ ] **Step 2: Derive the FY window**

Replace everything in `Home` from `const { m } = await searchParams;` down to the end of the `mandates` query with this. The order matters: the window has to be known before any range query can be written.

```tsx
  const { m } = await searchParams;
  const monthKey = (m ? toMonthKey(m) : null) ?? currentMonthKey();
  const [year, month] = monthKey.split("-").map(Number);

  // The FY on screen follows the month on screen, never the clock — that is
  // what keeps this render timezone-independent, and it is what lets you review
  // a finished year.
  const fy = financialYearOf(monthKey);
  const { startMonth: fyStartMonth, endMonth: fyEndMonth } =
    financialYearBounds(fy);

  // Month the record begins. An aggregate, so one row back and no entries.
  const [firstRow] = await db
    .select({ first: min(dayEntries.date) })
    .from(dayEntries)
    .where(eq(dayEntries.userId, session.user.id));
  const trackingStart = firstRow?.first ? firstRow.first.slice(0, 7) : null;

  // Later of the FY's first month and the month tracking began: browsing an FY
  // that predates the app must not report a hundred-day deficit for months that
  // were never recorded. null when nothing exists at or before this month — in
  // which case there is no history to carry, and the displayed month is empty
  // too, trackingStart being the earliest row there is.
  const windowStart =
    trackingStart === null || trackingStart > monthKey
      ? null
      : trackingStart > fyStartMonth
        ? trackingStart
        : fyStartMonth;
  const queryStart = windowStart ?? monthKey;

  const rows = await db
    .select({ date: dayEntries.date, status: dayEntries.status })
    .from(dayEntries)
    .where(
      and(
        eq(dayEntries.userId, session.user.id),
        gte(dayEntries.date, `${queryStart}-01`),
        lte(dayEntries.date, `${monthKey}-31`)
      )
    );

  // The whole window feeds the aggregate; only this month's rows seed Calendar.
  const windowEntries: Entries = Object.fromEntries(
    rows.map((r) => [r.date, r.status])
  );
  const entries: Entries = Object.fromEntries(
    rows
      .filter((r) => r.date.startsWith(monthKey))
      .map((r) => [r.date, r.status])
  );

  const periodRows = await db
    .select({
      startMonth: rtoTargets.startMonth,
      endMonth: rtoTargets.endMonth,
      percent: rtoTargets.percent,
    })
    .from(rtoTargets)
    .where(eq(rtoTargets.userId, session.user.id));

  const targetPercent = resolvePercent(monthKey, periodRows);

  // Mandates touching the FY window, not just this month: the aggregate needs
  // the earlier months too. The -31 upper bound is the same string comparison
  // trick the day_entries query uses — a bound past the end of a short month is
  // harmless against a fixed-width key.
  const mandates = await db
    .select({
      id: wfhMandates.id,
      startDate: wfhMandates.startDate,
      endDate: wfhMandates.endDate,
      reason: wfhMandates.reason,
    })
    .from(wfhMandates)
    .where(
      and(
        eq(wfhMandates.userId, session.user.id),
        lte(wfhMandates.startDate, `${monthKey}-31`),
        or(
          isNull(wfhMandates.endDate),
          gte(wfhMandates.endDate, `${queryStart}-01`)
        )
      )
    );

  // The banner announces this month's mandates only; the widened query above
  // would otherwise list ones that ended months ago.
  const monthMandates = mandates.filter((x) =>
    mandateTouchesMonth(x, monthKey)
  );

  // Two numbers, not the earlier months' entries: only the displayed month is
  // editable from here, so everything before it is constant for the life of the
  // mount and the client can re-run the single ceil on its own.
  const fyContext: FyContext | null =
    windowStart === null
      ? null
      : {
          fy,
          monthKey,
          fyStartMonth,
          fyEndMonth,
          windowStartMonth: windowStart,
          prior: aggregateMonths(
            monthsBetween(windowStart, shiftMonthKey(monthKey, -1)),
            windowEntries,
            periodRows,
            mandates
          ),
        };
```

`monthsBetween` returns `[]` when the displayed month is the window's first, which gives the `{ officeDays: 0, weightedEligible: 0 }` aggregate for free — no special case needed for August.

- [ ] **Step 3: Point the JSX at the new values**

Three edits in the returned markup.

Month navigation links — both now shift a key rather than a year/month pair:

```tsx
            <Link
              href={`/?m=${shiftMonthKey(monthKey, -1)}`}
              aria-label="Previous month"
              className="border border-rule px-3 py-1.5 font-mono text-sm hover:bg-ink/5"
            >
              ←
            </Link>
```

```tsx
            <Link
              href={`/?m=${shiftMonthKey(monthKey, 1)}`}
              aria-label="Next month"
              className="border border-rule px-3 py-1.5 font-mono text-sm hover:bg-ink/5"
            >
              →
            </Link>
```

The mandate banner switches to the filtered list — both the guard and the map:

```tsx
        {monthMandates.length > 0 && (
          <div className="mt-4 space-y-1 border-l-2 border-fade pl-3">
            {monthMandates.map((x) => (
              <p key={x.id} className="font-mono text-xs text-fade">
                Mandated WFH{" "}
                {x.endDate === null
                  ? `from ${formatDate(x.startDate)} — until further notice`
                  : `${formatDate(x.startDate)} – ${formatDate(x.endDate)}`}
                {x.reason ? ` (${x.reason})` : ""}
              </p>
            ))}
          </div>
        )}
```

The parameter is renamed `m` → `x` because `m` is now the destructured search param in scope. Shadowing it compiles but reads as a trap.

And `Calendar` gains one prop. It keeps the window-wide `mandates`: `isMandated` matches on dates, so a mandate outside the displayed month matches none of its days.

```tsx
      <Calendar
        key={monthKey}
        year={year}
        month={month}
        initialEntries={entries}
        targetPercent={targetPercent}
        mandates={mandates}
        fyContext={fyContext}
      />
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no output. A `fyContext` error here is expected only if you have not yet done Task 10 — in that case continue to Task 10 and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: load the financial-year window for the displayed month"
```

---

## Task 10: `Calendar` recomputes the FY locally

**Files:**
- Modify: `src/components/calendar.tsx`

- [ ] **Step 1: Extend the imports**

```tsx
import {
  computeFyStats,
  computeMonthStats,
  isEligible,
  isMandated,
  isWeekend,
  type DayStatus,
  type Entries,
  type FyContext,
  type WfhMandate,
} from "@/lib/rto";
```

- [ ] **Step 2: Accept the new prop**

```tsx
export function Calendar({
  year,
  month,
  initialEntries,
  targetPercent,
  mandates,
  fyContext,
}: {
  year: number;
  month: number;
  initialEntries: Entries;
  targetPercent: number;
  mandates: WfhMandate[];
  fyContext: FyContext | null;
}) {
```

- [ ] **Step 3: Recompute both stats from local state**

Replace the single `stats` line:

```tsx
  const stats = computeMonthStats(year, month, entries, targetPercent, mandates);
  // Recomputed on every tap from the same fixed prior window: the months before
  // this one are not editable from here, so the only moving part is `entries`.
  const fyStats = fyContext ? computeFyStats(fyContext, stats) : null;
  const weeks = monthGrid(year, month);
```

And pass it down:

```tsx
      <Stats stats={stats} fy={fyStats} />
```

`key={monthKey}` on `<Calendar>` in `page.tsx` is now load-bearing for a second reason: `fyContext` is a prop read on every render, but `entries` is seeded from `initialEntries` on mount only. Do not remove that key.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: one error remaining, in `calendar.tsx`, because `Stats` does not yet accept `fy`. Task 11 closes it.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar.tsx
git commit -m "feat: recompute financial-year stats client-side after each tap"
```

---

## Task 11: the FY block in `Stats`

**Files:**
- Modify: `src/components/stats.tsx`

- [ ] **Step 1: Rewrite the file**

The existing all-mandated early `return` has to become a component boundary: it currently returns before anything else can render, and the FY block must appear below it. Replace `src/components/stats.tsx` entirely:

```tsx
import {
  DEFAULT_RTO_PERCENT,
  formatMonth,
  fyVerdict,
  type FyStats,
  type MonthStats,
} from "@/lib/rto";

// Stamp-card meter — one ring per required office day, filled as stamped — with
// the financial year's running position underneath.
export function Stats({
  stats,
  fy,
}: {
  stats: MonthStats;
  fy: FyStats | null;
}) {
  return (
    <section aria-label="Progress" className="space-y-4">
      <MonthBlock stats={stats} fy={fy} />
      {fy && (
        <div className="border-t border-rule pt-4">
          <FyBlock fy={fy} monthRemaining={stats.remainingNeeded} />
        </div>
      )}
    </section>
  );
}

function MonthBlock({ stats, fy }: { stats: MonthStats; fy: FyStats | null }) {
  const {
    eligibleDays,
    officeDays,
    requiredDays,
    remainingNeeded,
    targetPercent,
    achievedPercent,
    mandatedDays,
  } = stats;
  const filled = Math.min(officeDays, requiredDays);
  const extra = officeDays - filled;

  // Nothing was owed this month. Rendering zero rings and "0/0 stamped ·
  // target met · 0%" would read as a bug, so say why instead.
  if (eligibleDays === 0 && mandatedDays > 0) {
    return (
      <div className="space-y-2">
        <p className="font-mono text-sm">No requirement — mandated WFH</p>
        <p className="text-sm text-fade">
          {mandatedDays} working {mandatedDays === 1 ? "day" : "days"} this month{" "}
          {mandatedDays === 1 ? "is" : "are"} mandated work from home. No office
          days are required.
        </p>
      </div>
    );
  }

  // A month shortfall the year has already banked for is not a shortfall, so it
  // loses the alarm colour. The FY line below is where the number to act on is.
  const owedForYear = fy === null || fy.remainingNeeded > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: requiredDays }, (_, i) => (
            <span
              key={i}
              className={`inline-block size-4 rounded-full border-2 ${
                i < filled
                  ? "border-stamp bg-stamp"
                  : "border-fade/60 bg-transparent"
              }`}
            />
          ))}
          {extra > 0 && (
            <span className="font-mono text-xs text-stamp">+{extra}</span>
          )}
        </div>
        <p className="font-mono text-sm">
          {officeDays}/{requiredDays} stamped ·{" "}
          {remainingNeeded > 0 ? (
            <span className={owedForYear ? "text-stamp" : "text-fade"}>
              {remainingNeeded} to go
            </span>
          ) : (
            <span className="text-holiday">target met</span>
          )}{" "}
          · {achievedPercent}%
        </p>
      </div>
      <p className="text-sm text-fade">
        {requiredDays} office days required — {targetPercent}% of {eligibleDays}{" "}
        eligible working days this month
        {targetPercent !== DEFAULT_RTO_PERCENT && (
          <span className="text-stamp">
            {" "}
            (adjusted from {DEFAULT_RTO_PERCENT}%)
          </span>
        )}
        {mandatedDays > 0 && <> · {mandatedDays} days mandated WFH</>}.
      </p>
    </div>
  );
}

function FyBlock({
  fy,
  monthRemaining,
}: {
  fy: FyStats;
  monthRemaining: number;
}) {
  const { cumulativeOffice, cumulativeRequired, balance } = fy;
  // Full when nothing is required: an empty bar against a zero target would
  // read as no progress rather than no obligation.
  const fillPercent =
    cumulativeRequired === 0
      ? 100
      : Math.min(100, Math.round((cumulativeOffice / cumulativeRequired) * 100));

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] tracking-widest text-fade uppercase">
        FY{fy.fy} · {formatMonth(fy.fyStartMonth)} –{" "}
        {formatMonth(fy.fyEndMonth)}
        {fy.isPartialWindow && (
          <> · counted from {formatMonth(fy.windowStartMonth)}</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Carries nothing the text does not, exactly as the rings above. */}
        <div
          aria-hidden
          className="h-2 w-40 border border-rule bg-transparent sm:w-56"
        >
          <div
            className="h-full bg-stamp"
            style={{ width: `${fillPercent}%` }}
          />
        </div>
        <p className="font-mono text-sm">
          {cumulativeOffice}/{cumulativeRequired}{" "}
          {fy.isFinalMonth ? "for the year" : "to date"}
          {balance > 0 && <span className="text-stamp"> +{balance}</span>}
        </p>
      </div>
      <p className="text-sm text-fade">{fyVerdict(fy, monthRemaining)}</p>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit && make lint
```

Expected: no output from `tsc`, then `✔ No ESLint warnings or errors`.

- [ ] **Step 3: Confirm the suite is still green**

```bash
npm test
```

Expected: `Tests  168 passed (168)`. Nothing here should move that number — if it does, a helper's behaviour changed rather than its caller.

- [ ] **Step 4: Verify in the browser**

```bash
npm run dev
```

At `http://localhost:3000`:

1. The FY line renders under the month rings, above the grid, reading `FY<year> · Aug … – Jul …`.
2. **Tap a weekday to stamp it as office.** The FY figures must move in the same frame as the rings, with no reload. This is the client-side recompute; if the FY numbers only change after a refresh, `fyStats` is being computed from the wrong source.
3. Tap the same day twice more to cycle it through leave and holiday. Eligible days drop, and `cumulativeRequired` may drop with them.
4. Page back to a month before your first record. The FY block disappears rather than reporting a large deficit.
5. Navigate to a July. The figures line reads `for the year`, not `to date`.
6. Narrow the window to phone width. The month block, rule, FY block and grid stay in one column with no horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add src/components/stats.tsx
git commit -m "feat: show financial-year progress under the month meter"
```

---

## Task 12: documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`
- Create: `docs/decisions/0005-financial-year-carryover.md`

- [ ] **Step 1: Add the FY invariant to `CLAUDE.md`**

In the `## Architecture` section, insert this immediately after the paragraph beginning **"Mandated WFH days are excluded outright"** and before `### Data flow`:

```markdown
**Compliance is cumulative within a financial year, which runs Aug–Jul.** An FY is
named for the calendar year it ends in: FY2027 is Aug 2026 – Jul 2027
(`FY_START_MONTH = 8`). Within a year a surplus settles a shortfall — miss a day in
February, work an extra in March, and the year is level — and nothing crosses the July
boundary. `computeFyStats` sums `eligibleDays × percent` per month into
`weightedEligible`, in **percent-points and deliberately un-rounded**, then divides by
100 and rounds up exactly once for the year. Rounding per month instead costs about six
office days a year, so never sum per-month `requiredDays`.

**The FY on screen follows the month on screen, never the clock.** `financialYearOf`
takes a month key for the same reason today's date is resolved client-side only: a
window keyed off `new Date()` would make server output timezone-dependent. It also means
browsing last July shows that year's verdict.

The FY window starts at the later of the FY's first month and the month of the user's
earliest `day_entries` row, so an FY that predates the app reports nothing rather than a
hundred-day deficit. `page.tsx` hands `<Calendar>` an `FyContext` holding **two numbers**
for the prior months, not their entries — only the displayed month is editable from that
view, so the client adds its live month to a fixed prior and re-runs the same single
`ceil`.
```

Then, in the paragraph beginning **"The target rate is per date range, not a constant"**, append this sentence after the sentence about month keys being text:

```markdown
The settings form posts whole `YYYY-MM-DD` dates from a date picker and `toMonthKey`
truncates them; `rto_targets` still stores `YYYY-MM`, and nothing downstream of the
action ever sees a day.
```

- [ ] **Step 2: Update `docs/architecture.md`**

Append to the bullet list under `## Computation rules`:

```markdown
- Financial years run Aug–Jul, named for the year they end in (FY2027 = Aug 2026 –
  Jul 2027). Compliance is cumulative within a year and resets at the boundary
- FY required office days = `ceil(Σ(eligible_m × percent_m) / 100)` — one rounding step
  for the year, not one per month
- The FY shown is the one containing the *displayed* month, never the current date
- The FY window starts no earlier than the month of the first recorded day
```

And append to the `## Data flow` paragraph:

```markdown
The page also loads the FY-to-date window — entries and mandates from the FY's first
counted month through the displayed month — and passes the earlier months to the client
as a two-number aggregate, so the calendar can recompute the year's position locally
after each tap.
```

- [ ] **Step 3: Write the ADR**

Create `docs/decisions/0005-financial-year-carryover.md`:

```markdown
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
- A shortfall carries forward as well as a surplus: a missed February raises March's
  effective need. That is symmetry, not a bug.
- The window starts no earlier than the month of the first recorded day. An FY that
  predates the app therefore reports nothing rather than a ~100-day deficit for months
  that were never tracked — at the cost of a partial year's total not matching what the
  employer would compute for that year. The block says `counted from <month>` when so.
- Reviewing a past FY works, and reviewing a month before the record starts shows no FY
  block at all.
- Nothing crosses a July boundary. A surplus banked in FY2027 is gone in FY2028.
- No schema change: the balance is derived on every render from `day_entries`,
  `rto_targets` and `wfh_mandates`. The cost is one extra aggregate query plus a
  `day_entries` range of at most twelve months for one user, both served by the
  `(user_id, date)` primary key.
- `page.tsx` sends the client two numbers for the prior months rather than their entries,
  so the FY figures stay recomputable locally without shipping the year's history.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/architecture.md docs/decisions/0005-financial-year-carryover.md
git commit -m "docs: record financial-year carryover rules and rationale"
```

---

## Task 13: full verification

**Files:** none — this task only runs things.

- [ ] **Step 1: Tests, lint, production build**

```bash
npm test && make lint && npm run build
```

Expected: `Tests  168 passed (168)`, `✔ No ESLint warnings or errors`, and a build ending in `Compiled successfully`. The 168 is the sum of the baseline 124 and the 44 cases added in Tasks 1, 3, 4, 5, 6, 7 and 8 — if it differs, trust the per-task counts and find the missing block rather than editing this number.

`npm run build` matters here beyond type-checking: `vercel.json` runs `next build && node scripts/migrate.mjs`, and a build failure is what stops a bad deploy. No migration is pending in this work, so the build is the whole gate.

- [ ] **Step 2: End-to-end pass in the browser**

```bash
npm run dev
```

1. `/settings` — both period fields are date pickers matching the mandate form; a mid-month pick renders as a whole-month range in the row.
2. Add a period covering a past month at 80%, then visit that month. Its own requirement rises, and the FY cumulative rises with it.
3. Stamp enough office days in that month to overshoot, then move to the following month. The FY line reads *ahead*, and the next month's "to go" is in fade rather than red.
4. Delete the test period. The FY figures fall back to 40%.
5. Add a mandate covering a whole past month, then visit it: the month block reads "No requirement — mandated WFH" **and the FY block still renders beneath it**. That ordering is the one the old early `return` broke.
6. Delete the test mandate.

- [ ] **Step 3: Confirm the working tree is clean**

```bash
git status --short
```

Expected: empty. `AGENTS.md` is rewritten by `next dev` — if it shows as modified, commit it with the rest rather than reverting it, per the note in the file itself.

- [ ] **Step 4: Request review**

Use the `superpowers:requesting-code-review` skill, or run `/code-review`, before merging. Point the reviewer at three things specifically:

1. The single-`ceil` invariant — anywhere `requiredDays` is summed across months is a bug.
2. `page.tsx`'s window derivation, particularly `trackingStart > monthKey` returning `null`, and the `-31` upper bounds.
3. Whether `fyVerdict`'s eight branches read well on screen, which is a judgement call no test settles.

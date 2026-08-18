# Mandated WFH Exclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user record a management-mandated work-from-home period by date range — open-ended when the end is "until further notice" — and exclude those weekdays from the monthly RTO requirement entirely.

**Architecture:** A new `wfh_mandates` table stores inclusive day ranges (`start_date`, `end_date` nullable) per user. Mandated weekdays drop out of the eligible pool exactly as holidays do, so a partial month prorates automatically. All range logic is pure string comparison on `YYYY-MM-DD` keys in `src/lib/rto.ts`, unit-testable in the existing node environment and constructing no `Date` for comparison. A mandate takes precedence over any recorded day status, which keeps `officeDays ≤ eligibleDays` true. The `/settings` route grows a third section managing mandates through server actions that reject overlapping ranges.

**Tech Stack:** Next.js 16 (App Router), React 19, Drizzle ORM, Neon Postgres, Auth.js v5, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-mandated-wfh-exclusions-design.md`

---

## Before you start

Read `CLAUDE.md` and `AGENTS.md` in the repo root. Three invariants govern every task here:

1. **Dates are text, never `Date`.** Day keys are `YYYY-MM-DD`, month keys are `YYYY-MM`. Both are zero-padded and fixed-width, so `<=` and `>=` on the strings are correct calendar comparisons. Never parse a date string through `new Date("2026-08-12")` — that goes through the local timezone and shifts the day. `new Date(Date.UTC(y, m - 1, d))` from split integer components is fine and is what the existing `dayOfWeek` helper already does.
2. **`src/lib/rto.ts` is pure and isomorphic.** Both the server (`page.tsx`) and the client (`calendar.tsx`) call `computeMonthStats`. It must not touch the database, the network, or the clock.
3. **A mandate beats a day status.** If a date is inside a mandate, it is excluded no matter what `entries[date]` says. Get this order wrong and `achievedPercent` can exceed 100.

Local dev points at the Neon **dev** branch, not production. Verify before Task 5:

```bash
grep '^DATABASE_URL=' .env.local | grep -c 'ep-flat-unit-azuxnnpa'   # expect: 1
```

If that prints `0`, stop and ask — you may be pointed at production, and Task 5 pushes schema.

Confirm a green baseline:

```bash
npm test
```

Expected: `Test Files 1 passed (1)`, `Tests 31 passed (31)`.

**Worked example used throughout.** August 2026 has 21 weekdays. A mandate from `2026-08-12` with no end date covers 14 of them, leaving 7 eligible, so `ceil(7 × 40 / 100) = 3` required. Unmandated, that month is 21 eligible and 9 required. These exact numbers are asserted in Task 4 — they were verified against the calendar, do not "correct" them.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/lib/action-state.ts` | The `ActionState` type alone. Client-safe: exports no runtime value |
| `src/lib/require-user.ts` | `requireUserId()`. Separate from the type so client imports cannot pull `auth` into the browser bundle |
| `src/app/mandate-actions.ts` | Server actions for mandate CRUD; validation and overlap rejection |
| `src/components/mandate-form.tsx` | Client. One form for both add and edit, via `useActionState` |
| `src/components/mandate-row.tsx` | Client. One mandate row; owns the view/edit toggle |
| `src/components/delete-mandate-button.tsx` | Client. Delete confirmation `<dialog>` |
| `docs/decisions/0003-mandated-wfh-exclusions.md` | ADR recording the separate-table choice |

**Modify:**

| File | Change |
|---|---|
| `src/lib/rto.ts` | Add `WfhMandate`, `OPEN_ENDED_DATE`, `isMandated`, `mandatesOverlap`, `eachDate`, `countWeekdaysInMandate`, `formatDate`, `formatMandateRange`, `isEligible`, `isValidDateKey`; `computeMonthStats` gains a `mandates` param; `MonthStats` gains `mandatedDays` |
| `src/lib/rto.test.ts` | New describes; no existing assertion changes |
| `src/db/schema.ts` | Add the `wfhMandates` table |
| `src/app/settings-actions.ts` | Drop the local `ActionState` and `requireUserId`; import both from `src/lib` |
| `src/components/period-form.tsx:4` | Import `ActionState` from `@/lib/action-state` |
| `src/components/delete-period-button.tsx:4` | Import `ActionState` from `@/lib/action-state` |
| `src/app/settings/page.tsx` | Query mandates; render the third section |
| `src/app/globals.css` | Add `.mandate-hatch` |
| `src/components/calendar.tsx` | Accept `mandates`; hatch and label mandated cells; mute stamps on them; week badge and stats via `isEligible` |
| `src/app/page.tsx` | Query mandates intersecting the month; render the banner; pass the prop |
| `src/components/stats.tsx` | "No requirement — mandated WFH" state; mandated-days clause |
| `CLAUDE.md`, `docs/architecture.md`, `README.md` | Eligible-days formula and the new table |

**Note on `ActionState`:** the spec suggested `settings-actions.ts` re-export the type for safety. Only two files import it and both are updated in Task 6, so the re-export is dead weight and is omitted — a `"use server"` module exporting anything but async functions is a rule best not tested.

---

## Task 1: Mandate range predicates

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("isMandated", () => {
  const closed: WfhMandate[] = [
    { startDate: "2026-08-12", endDate: "2026-08-20" },
  ];

  it("is true for a date inside a closed mandate", () => {
    expect(isMandated("2026-08-17", closed)).toBe(true);
  });

  it("includes both boundary dates", () => {
    expect(isMandated("2026-08-12", closed)).toBe(true);
    expect(isMandated("2026-08-20", closed)).toBe(true);
  });

  it("is false one day either side", () => {
    expect(isMandated("2026-08-11", closed)).toBe(false);
    expect(isMandated("2026-08-21", closed)).toBe(false);
  });

  it("treats a null endDate as until further notice", () => {
    const ongoing: WfhMandate[] = [
      { startDate: "2026-08-12", endDate: null },
    ];
    expect(isMandated("2026-08-12", ongoing)).toBe(true);
    expect(isMandated("2099-01-01", ongoing)).toBe(true);
    expect(isMandated("2026-08-11", ongoing)).toBe(false);
  });

  it("is false when there are no mandates", () => {
    expect(isMandated("2026-08-17", [])).toBe(false);
  });

  it("matches any mandate in the list", () => {
    const two: WfhMandate[] = [
      { startDate: "2026-03-02", endDate: "2026-03-06" },
      { startDate: "2026-08-12", endDate: null },
    ];
    expect(isMandated("2026-03-04", two)).toBe(true);
    expect(isMandated("2026-08-31", two)).toBe(true);
    expect(isMandated("2026-05-04", two)).toBe(false);
  });

  it("ignores the reason field", () => {
    expect(
      isMandated("2026-08-17", [
        { startDate: "2026-08-12", endDate: null, reason: "flood incident" },
      ])
    ).toBe(true);
  });
});

describe("mandatesOverlap", () => {
  const m = (startDate: string, endDate: string | null): WfhMandate => ({
    startDate,
    endDate,
  });

  it("is true for identical mandates", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-12", "2026-08-20"))
    ).toBe(true);
  });

  it("is true when they share exactly one boundary day", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-20", "2026-08-25"))
    ).toBe(true);
  });

  it("is false for adjacent mandates that do not touch", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-21", "2026-08-25"))
    ).toBe(false);
  });

  it("is true when an open-ended mandate starts before the other ends", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-15", null))
    ).toBe(true);
  });

  it("is false when an open-ended mandate starts after the other ends", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-21", null))
    ).toBe(false);
  });

  it("is true when both are open-ended", () => {
    expect(mandatesOverlap(m("2026-08-12", null), m("2030-01-01", null))).toBe(
      true
    );
  });

  it("is order-independent", () => {
    const a = m("2026-08-12", "2026-08-20");
    const b = m("2026-08-15", null);
    expect(mandatesOverlap(a, b)).toBe(mandatesOverlap(b, a));
  });
});
```

Add to the existing import block at the top of the file:

```ts
  isMandated,
  mandatesOverlap,
  type WfhMandate,
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts`

Expected: FAIL. TypeScript/Vitest reports `isMandated` is not exported by `./rto`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/rto.ts`, add directly below the existing `periodsOverlap` function:

```ts
export interface WfhMandate {
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string | null; // YYYY-MM-DD inclusive, or null = until further notice
  reason?: string | null; // display only; every helper here ignores it
}

/**
 * Stand-in for "no end date". Same fixed width as a real YYYY-MM-DD key, so
 * comparisons stay pure string compares and no Date is ever constructed.
 * Day-granularity sibling of OPEN_ENDED above.
 */
const OPEN_ENDED_DATE = "9999-12-31";

/** True when `date` falls inside any mandate. */
export function isMandated(date: string, mandates: WfhMandate[]): boolean {
  return mandates.some(
    (m) => date >= m.startDate && date <= (m.endDate ?? OPEN_ENDED_DATE)
  );
}

/** True when two mandates share at least one day. */
export function mandatesOverlap(a: WfhMandate, b: WfhMandate): boolean {
  return (
    a.startDate <= (b.endDate ?? OPEN_ENDED_DATE) &&
    b.startDate <= (a.endDate ?? OPEN_ENDED_DATE)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`

Expected: PASS, `Tests 45 passed (45)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: mandate range predicates"
```

---

## Task 2: Counting weekdays in a mandate

`countWeekdaysInMandate` powers the delete-confirmation copy. It returns `null` rather than a number for an open-ended mandate, forcing the caller to handle the unbounded case instead of quietly rendering a wrong count — the same contract as the existing `countMonthsInPeriod`.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("countWeekdaysInMandate", () => {
  it("counts weekdays inclusively, skipping the weekend", () => {
    // Wed 12 Aug 2026 – Thu 20 Aug: 12,13,14,17,18,19,20 = 7 weekdays
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-12",
        endDate: "2026-08-20",
      })
    ).toBe(7);
  });

  it("counts a single weekday as 1", () => {
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-12", // Wed
        endDate: "2026-08-12",
      })
    ).toBe(1);
  });

  it("counts a single weekend day as 0", () => {
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-15", // Sat
        endDate: "2026-08-16", // Sun
      })
    ).toBe(0);
  });

  it("counts a full Mon-Sun week as 5", () => {
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-17", // Mon
        endDate: "2026-08-23", // Sun
      })
    ).toBe(5);
  });

  it("counts across a month boundary", () => {
    // Mon 31 Aug 2026 + Tue 1 Sep + Wed 2 Sep
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-31",
        endDate: "2026-09-02",
      })
    ).toBe(3);
  });

  it("counts across a year boundary", () => {
    // Wed 30 Dec 2026, Thu 31 Dec, Fri 1 Jan 2027 (Sat 2, Sun 3 skipped), Mon 4
    expect(
      countWeekdaysInMandate({
        startDate: "2026-12-30",
        endDate: "2027-01-04",
      })
    ).toBe(4);
  });

  it("returns null for an open-ended mandate", () => {
    expect(
      countWeekdaysInMandate({ startDate: "2026-08-12", endDate: null })
    ).toBeNull();
  });
});
```

Add `countWeekdaysInMandate` to the import block at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts`

Expected: FAIL. `countWeekdaysInMandate` is not exported by `./rto`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/rto.ts`, add below `mandatesOverlap`. `toDateString` and `isWeekend` already exist above in this file — do not redefine them.

```ts
/**
 * Inclusive day-by-day walk from `start` to `end`. UTC component math only:
 * the Date is built from split integers, never parsed from the string.
 */
function* eachDate(start: string, end: string): Generator<string> {
  const [y, m, d] = start.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  for (;;) {
    const date = toDateString(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      cursor.getUTCDate()
    );
    if (date > end) return;
    yield date;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

/**
 * Weekdays a closed mandate covers, inclusive. `null` when open-ended —
 * returning null rather than a number forces callers to handle the unbounded
 * case instead of quietly rendering a wrong count.
 *
 * Walks the range rather than using a closed-form weekday formula: the longest
 * realistic span is a few thousand iterations, evaluated once per delete-dialog
 * render, and the walk is obviously correct where the formula is not.
 */
export function countWeekdaysInMandate(mandate: WfhMandate): number | null {
  if (mandate.endDate === null) return null;
  let count = 0;
  for (const date of eachDate(mandate.startDate, mandate.endDate)) {
    if (!isWeekend(date)) count++;
  }
  return count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`

Expected: PASS, `Tests 52 passed (52)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: count weekdays covered by a mandate"
```

---

## Task 3: Date formatting and validation

Two unrelated-looking helpers land together because both are pure string/UTC work on a day key and both are needed by the settings UI and actions in Tasks 8–11.

`isValidDateKey` lives here, not in the action file, precisely so it can be unit-tested — `src/lib/rto.ts` is the only module under test, per the project convention.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("formatDate", () => {
  it("renders a YYYY-MM-DD key as day, abbreviated month, year", () => {
    expect(formatDate("2026-08-12")).toBe("12 Aug 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2027-12-31")).toBe("31 Dec 2027");
  });

  it("strips the leading zero from the day", () => {
    expect(formatDate("2026-08-05")).toBe("5 Aug 2026");
  });
});

describe("formatMandateRange", () => {
  it("renders a closed mandate as a range", () => {
    expect(
      formatMandateRange({ startDate: "2026-08-12", endDate: "2026-08-20" })
    ).toBe("12 Aug 2026 – 20 Aug 2026");
  });

  it("marks an open-ended mandate as until further notice", () => {
    expect(
      formatMandateRange({ startDate: "2026-08-12", endDate: null })
    ).toBe("12 Aug 2026 – until further notice");
  });
});

describe("isValidDateKey", () => {
  it("accepts a real calendar day", () => {
    expect(isValidDateKey("2026-08-12")).toBe(true);
    expect(isValidDateKey("2026-02-28")).toBe(true);
  });

  it("accepts a real leap day", () => {
    expect(isValidDateKey("2024-02-29")).toBe(true);
  });

  it("rejects a day that does not exist in that month", () => {
    expect(isValidDateKey("2026-02-30")).toBe(false);
    expect(isValidDateKey("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isValidDateKey("2026-04-31")).toBe(false);
  });

  it("rejects an out-of-range month or day", () => {
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("2026-00-10")).toBe(false);
    expect(isValidDateKey("2026-08-32")).toBe(false);
    expect(isValidDateKey("2026-08-00")).toBe(false);
  });

  it("rejects anything that is not a zero-padded YYYY-MM-DD key", () => {
    expect(isValidDateKey("")).toBe(false);
    expect(isValidDateKey("2026-8-12")).toBe(false);
    expect(isValidDateKey("2026-08")).toBe(false);
    expect(isValidDateKey("12/08/2026")).toBe(false);
    expect(isValidDateKey("2026-08-12T00:00:00Z")).toBe(false);
  });
});
```

Add `formatDate`, `formatMandateRange`, and `isValidDateKey` to the import block.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts`

Expected: FAIL. `formatDate` is not exported by `./rto`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/rto.ts`, add below the existing `formatPeriodRange`. `MONTH_ABBR` already exists above — reuse it, do not redefine it.

```ts
/** "2026-08-12" → "12 Aug 2026". */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTH_ABBR[month - 1]} ${year}`;
}

/** "12 Aug 2026 – 20 Aug 2026", or "12 Aug 2026 – until further notice". */
export function formatMandateRange(mandate: WfhMandate): string {
  const end =
    mandate.endDate === null
      ? "until further notice"
      : formatDate(mandate.endDate);
  return `${formatDate(mandate.startDate)} – ${end}`;
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * True when `value` is a real calendar day in YYYY-MM-DD form. The regex alone
 * admits 2026-02-30, so the components are round-tripped through Date.UTC and
 * compared back — still UTC-only math, never a parse of the string itself.
 */
export function isValidDateKey(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}
```

The en dash in `formatMandateRange` is `–` (U+2013), matching the existing `formatPeriodRange`. Copy it, do not retype it as a hyphen.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`

Expected: PASS, `Tests 62 passed (62)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: date formatting and calendar-day validation"
```

---

## Task 4: Eligibility and month stats with mandates

The core of the feature. Two things happen here: the eligible-day rule moves into one exported predicate, and `computeMonthStats` learns about mandates.

The mandate check comes **before** the leave/holiday check, so a day that is both is counted once, as mandated. `officeDays` therefore excludes an `office` stamp inside a mandate, which is what keeps `officeDays ≤ eligibleDays` and `achievedPercent ≤ 100`.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("isEligible", () => {
  const none: WfhMandate[] = [];
  const mandate: WfhMandate[] = [{ startDate: "2026-08-12", endDate: null }];

  it("counts an untouched weekday", () => {
    expect(isEligible("2026-08-11", {}, none)).toBe(true);
  });

  it("counts an office day", () => {
    expect(isEligible("2026-08-11", { "2026-08-11": "office" }, none)).toBe(true);
  });

  it("excludes leave and holiday", () => {
    expect(isEligible("2026-08-11", { "2026-08-11": "leave" }, none)).toBe(false);
    expect(isEligible("2026-08-11", { "2026-08-11": "holiday" }, none)).toBe(
      false
    );
  });

  it("excludes a mandated day with no status", () => {
    expect(isEligible("2026-08-12", {}, mandate)).toBe(false);
  });

  it("excludes a mandated day even when stamped as office", () => {
    expect(isEligible("2026-08-12", { "2026-08-12": "office" }, mandate)).toBe(
      false
    );
  });

  it("excludes a mandated day also marked as leave", () => {
    expect(isEligible("2026-08-12", { "2026-08-12": "leave" }, mandate)).toBe(
      false
    );
  });
});

// Aug 2026: 21 weekdays. A mandate from Wed 12 Aug covers 14 of them,
// leaving 7 eligible → ceil(7 * 40 / 100) = 3 required.
describe("computeMonthStats with mandates", () => {
  const fromAug12: WfhMandate[] = [{ startDate: "2026-08-12", endDate: null }];

  it("scores an unmandated August at full strength", () => {
    const s = computeMonthStats(2026, 8, {});
    expect(s.eligibleDays).toBe(21);
    expect(s.requiredDays).toBe(9); // ceil(8.4)
    expect(s.mandatedDays).toBe(0);
  });

  it("prorates a partially mandated month", () => {
    const s = computeMonthStats(2026, 8, {}, DEFAULT_RTO_PERCENT, fromAug12);
    expect(s.eligibleDays).toBe(7);
    expect(s.mandatedDays).toBe(14);
    expect(s.requiredDays).toBe(3); // ceil(2.8)
    expect(s.remainingNeeded).toBe(3);
  });

  it("counts office days before the mandate normally", () => {
    const s = computeMonthStats(
      2026,
      8,
      { "2026-08-03": "office", "2026-08-04": "office" },
      DEFAULT_RTO_PERCENT,
      fromAug12
    );
    expect(s.officeDays).toBe(2);
    expect(s.remainingNeeded).toBe(1);
    expect(s.achievedPercent).toBe(29); // round(2/7 * 100)
  });

  it("reports no requirement for a fully mandated month", () => {
    const all: WfhMandate[] = [
      { startDate: "2026-09-01", endDate: "2026-09-30" },
    ];
    const s = computeMonthStats(2026, 9, {}, DEFAULT_RTO_PERCENT, all);
    expect(s.eligibleDays).toBe(0);
    expect(s.requiredDays).toBe(0);
    expect(s.remainingNeeded).toBe(0);
    expect(s.achievedPercent).toBe(0);
    expect(s.mandatedDays).toBe(22); // Sep 2026 weekdays
  });

  it("ignores an office stamp inside a mandate", () => {
    const all: WfhMandate[] = [
      { startDate: "2026-09-01", endDate: "2026-09-30" },
    ];
    const s = computeMonthStats(
      2026,
      9,
      { "2026-09-08": "office" },
      DEFAULT_RTO_PERCENT,
      all
    );
    expect(s.officeDays).toBe(0);
    expect(s.achievedPercent).toBe(0); // cannot exceed 100 with 0 eligible
  });

  it("counts a mandated leave day once, as mandated", () => {
    const withLeave = computeMonthStats(
      2026,
      8,
      { "2026-08-13": "leave" },
      DEFAULT_RTO_PERCENT,
      fromAug12
    );
    const without = computeMonthStats(2026, 8, {}, DEFAULT_RTO_PERCENT, fromAug12);
    expect(withLeave.eligibleDays).toBe(without.eligibleDays);
    expect(withLeave.mandatedDays).toBe(without.mandatedDays);
  });

  it("shrinks week denominators, to zero for a fully mandated week", () => {
    const s = computeMonthStats(2026, 8, {}, DEFAULT_RTO_PERCENT, fromAug12);
    // Aug 2026 starts Sat 1, and monthWeekdays drops weekends, so the FIRST
    // chunk is Mon 3 - Fri 7. There is no partial chunk at this month's edge.
    expect(s.weeks[0]).toMatchObject({
      start: "2026-08-03",
      eligibleDays: 5,
      officeDays: 0,
    });
    // Mon 17 - Fri 21 is entirely inside the mandate
    const fullyMandated = s.weeks.find((w) => w.start === "2026-08-17");
    expect(fullyMandated).toMatchObject({ eligibleDays: 0, officeDays: 0 });
  });

  it("is a no-op when no mandates are passed", () => {
    const bare = computeMonthStats(2026, 1, {});
    const explicit = computeMonthStats(2026, 1, {}, DEFAULT_RTO_PERCENT, []);
    expect(bare).toEqual(explicit);
    expect(bare.mandatedDays).toBe(0);
  });
});
```

Add `isEligible` to the import block.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts`

Expected: FAIL. `isEligible` is not exported, and `s.mandatedDays` does not exist on `MonthStats`.

- [ ] **Step 3: Add `mandatedDays` to `MonthStats`**

In `src/lib/rto.ts`, in the `MonthStats` interface, add after `achievedPercent`:

```ts
  mandatedDays: number; // mandated weekdays in the month, excluded from eligible
```

- [ ] **Step 4: Add `isEligible`**

In `src/lib/rto.ts`, add above `computeMonthStats`:

```ts
/**
 * True when a **weekday** counts toward the requirement. Callers filter
 * weekends first. A mandate wins over any recorded status — the exclusion is a
 * property of the mandate, not of what the user tapped.
 *
 * This is the single definition of the eligible-day rule; computeMonthStats and
 * the calendar's per-week badge both defer to it.
 */
export function isEligible(
  date: string,
  entries: Entries,
  mandates: WfhMandate[]
): boolean {
  if (isMandated(date, mandates)) return false;
  const status = entries[date];
  return status !== "leave" && status !== "holiday";
}
```

- [ ] **Step 5: Thread mandates through `computeMonthStats`**

Replace the whole of `computeMonthStats` in `src/lib/rto.ts` with:

```ts
export function computeMonthStats(
  year: number,
  month: number,
  entries: Entries,
  targetPercent: number = DEFAULT_RTO_PERCENT,
  mandates: WfhMandate[] = []
): MonthStats {
  const weekdays = monthWeekdays(year, month);

  let eligibleDays = 0;
  let officeDays = 0;
  let mandatedDays = 0;
  const weeks: WeekStats[] = [];
  let current: WeekStats | null = null;

  for (const date of weekdays) {
    // A new Mon–Fri chunk starts on Monday or at the month's first weekday
    if (current === null || dayOfWeek(date) === 1) {
      current = { start: date, end: date, eligibleDays: 0, officeDays: 0 };
      weeks.push(current);
    }
    current.end = date;

    // Counted before the eligibility check: a mandated day that is also marked
    // leave is one mandated day, not one of each.
    if (isMandated(date, mandates)) mandatedDays++;
    if (!isEligible(date, entries, mandates)) continue;

    eligibleDays++;
    current.eligibleDays++;
    if (entries[date] === "office") {
      officeDays++;
      current.officeDays++;
    }
  }

  const requiredDays = Math.ceil((eligibleDays * targetPercent) / 100);
  return {
    eligibleDays,
    officeDays,
    requiredDays,
    remainingNeeded: Math.max(0, requiredDays - officeDays),
    targetPercent,
    achievedPercent:
      eligibleDays === 0 ? 0 : Math.round((officeDays / eligibleDays) * 100),
    mandatedDays,
    weeks,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`

Expected: PASS, `Tests 78 passed (78)`. Every pre-existing assertion still passes — the new parameter defaults to `[]`, so unmandated behaviour is unchanged.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`

Expected: no output. `stats.tsx` destructures `MonthStats` but does not enumerate it exhaustively, so the new field breaks nothing yet.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: exclude mandated weekdays from eligible days"
```

---

## Task 5: The `wfh_mandates` table

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Confirm you are on the dev database**

Run: `grep '^DATABASE_URL=' .env.local | grep -c 'ep-flat-unit-azuxnnpa'`

Expected: `1`. If it prints `0`, stop and ask — the next step writes schema.

- [ ] **Step 2: Add the table**

In `src/db/schema.ts`, append below the existing `rtoTargets` definition. `index`, `pgTable`, and `text` are already imported at the top of the file.

```ts
export const wfhMandates = pgTable(
  "wfh_mandates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(), // YYYY-MM-DD inclusive; text avoids TZ drift
    endDate: text("end_date"), // YYYY-MM-DD inclusive, or NULL = until further notice
    reason: text("reason"), // optional human note; never parsed
  },
  (t) => [index("wfh_mandates_user_start_idx").on(t.userId, t.startDate)]
);
```

- [ ] **Step 3: Push the schema**

Run: `npx drizzle-kit push`

Expected: it reports creating table `wfh_mandates` and applies without prompting for a data-loss confirmation. There is no migrations directory in this project by design — `push` is the mechanism.

- [ ] **Step 4: Verify the table exists and is empty**

Run:

```bash
npx drizzle-kit studio --port 4984 &
sleep 3 && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4984 && kill %1
```

Expected: `200`. If `drizzle-kit studio` is unavailable, verify instead by starting `npm run dev`, loading `/settings`, and confirming the page renders without a database error — Task 9 adds the query that reads this table, so before then an empty table is all that is required.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: wfh_mandates table"
```

---

## Task 6: Extract the shared action helpers

Pure refactor, no behaviour change. It exists so `mandate-actions.ts` and the mandate components do not import out of the *targets* feature, and so the `ActionState` type a client component imports lives in a module that does not also import `auth`.

**Files:**
- Create: `src/lib/action-state.ts`
- Create: `src/lib/require-user.ts`
- Modify: `src/app/settings-actions.ts:14-17`, `src/app/settings-actions.ts:42-46`
- Modify: `src/components/period-form.tsx:4`
- Modify: `src/components/delete-period-button.tsx:4`

- [ ] **Step 1: Create the type module**

Create `src/lib/action-state.ts`:

```ts
/**
 * What every settings server action resolves to. `null` means "not submitted
 * yet", which is the initial state useActionState is seeded with.
 *
 * Deliberately alone in this module and exporting no runtime value, so a client
 * component can import it without pulling anything server-only into the bundle.
 */
export type ActionState = { error?: string } | null;
```

- [ ] **Step 2: Create the session guard**

Create `src/lib/require-user.ts`:

```ts
import { auth } from "@/auth";

/**
 * The session user's id, or throws. Authentication failures throw rather than
 * returning an ActionState error: they are not something the user can fix by
 * editing the form.
 *
 * Kept apart from the ActionState type so importing that type into a client
 * component cannot drag `auth` into the client bundle.
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}
```

- [ ] **Step 3: Point `settings-actions.ts` at both**

In `src/app/settings-actions.ts`, delete these two blocks:

```ts
export type ActionState = { error?: string } | null;
```

```ts
async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}
```

Then replace the import block at the top with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { rtoTargets } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireUserId } from "@/lib/require-user";
import {
  formatPeriodRange,
  periodsOverlap,
  type TargetPeriod,
} from "@/lib/rto";
```

The `import { auth } from "@/auth"` line goes — nothing in this file uses it now.

- [ ] **Step 4: Update the two client importers**

In `src/components/period-form.tsx`, replace line 4:

```ts
import type { ActionState } from "@/lib/action-state";
```

In `src/components/delete-period-button.tsx`, replace line 4 with two lines:

```ts
import { deleteTargetPeriod } from "@/app/settings-actions";
import type { ActionState } from "@/lib/action-state";
```

- [ ] **Step 5: Verify nothing else imported the old names**

Run: `grep -rn "import.*ActionState" src/ | grep -v "lib/action-state"`

Expected: every remaining hit resolves to `@/lib/action-state`; no file still imports `ActionState` from `@/app/settings-actions`. Filter to import lines deliberately — a bare `grep ActionState` also matches React's `useActionState` hook and the prose in `require-user.ts`, so a raw hit count means nothing here.

- [ ] **Step 6: Typecheck and test**

Run: `npx tsc --noEmit && npm test && npm run lint`

Expected: no type errors, `Tests 78 passed (78)`, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/action-state.ts src/lib/require-user.ts src/app/settings-actions.ts src/components/period-form.tsx src/components/delete-period-button.tsx
git commit -m "refactor: extract ActionState and requireUserId"
```

---

## Task 7: Mandate server actions

Structurally a mirror of `settings-actions.ts`. Validation failures return `{ error }` for inline rendering; authentication failures throw. Every write is scoped by `userId` as well as `id`, so one user cannot address another's row by guessing an id.

**Files:**
- Create: `src/app/mandate-actions.ts`

- [ ] **Step 1: Write the actions**

Create `src/app/mandate-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { wfhMandates } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireUserId } from "@/lib/require-user";
import {
  formatMandateRange,
  isValidDateKey,
  mandatesOverlap,
  type WfhMandate,
} from "@/lib/rto";

const REASON_MAX = 200;

/** Validation failures return a message; auth failures throw. */
function parse(
  formData: FormData
): { ok: true; mandate: WfhMandate } | { ok: false; error: string } {
  const startDate = String(formData.get("startDate") ?? "");
  const rawEnd = String(formData.get("endDate") ?? "").trim();
  const endDate = rawEnd === "" ? null : rawEnd;
  const rawReason = String(formData.get("reason") ?? "").trim();
  const reason = rawReason === "" ? null : rawReason;

  if (!isValidDateKey(startDate)) {
    return { ok: false, error: "Start date must be a real calendar date." };
  }
  if (endDate !== null && !isValidDateKey(endDate)) {
    return {
      ok: false,
      error: "End date must be a real calendar date, or blank.",
    };
  }
  if (endDate !== null && endDate < startDate) {
    return { ok: false, error: "End date cannot be before the start date." };
  }
  if (reason !== null && reason.length > REASON_MAX) {
    return {
      ok: false,
      error: `Reason must be ${REASON_MAX} characters or fewer.`,
    };
  }
  return { ok: true, mandate: { startDate, endDate, reason } };
}

/** Returns an error message when `mandate` collides with an existing row. */
async function overlapError(
  userId: string,
  mandate: WfhMandate,
  excludeId?: string
): Promise<string | null> {
  const existing = await db
    .select({
      startDate: wfhMandates.startDate,
      endDate: wfhMandates.endDate,
    })
    .from(wfhMandates)
    .where(
      excludeId
        ? and(eq(wfhMandates.userId, userId), ne(wfhMandates.id, excludeId))
        : eq(wfhMandates.userId, userId)
    );

  const clash = existing.find((e) => mandatesOverlap(e, mandate));
  if (!clash) return null;
  return `Overlaps an existing mandate (${formatMandateRange(clash)}).`;
}

function revalidate() {
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function addWfhMandate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const clash = await overlapError(userId, parsed.mandate);
  if (clash) return { error: clash };

  await db.insert(wfhMandates).values({ userId, ...parsed.mandate });
  revalidate();
  return null;
}

export async function updateWfhMandate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing mandate id." };

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const clash = await overlapError(userId, parsed.mandate, id);
  if (clash) return { error: clash };

  // Scoped by userId so one user cannot address another's row by guessing an id.
  await db
    .update(wfhMandates)
    .set(parsed.mandate)
    .where(and(eq(wfhMandates.id, id), eq(wfhMandates.userId, userId)));
  revalidate();
  return null;
}

export async function deleteWfhMandate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing mandate id." };

  await db
    .delete(wfhMandates)
    .where(and(eq(wfhMandates.id, id), eq(wfhMandates.userId, userId)));
  revalidate();
  return null;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit && npm run lint`

Expected: no output from either.

- [ ] **Step 3: Commit**

```bash
git add src/app/mandate-actions.ts
git commit -m "feat: server actions for WFH mandates"
```

---

## Task 8: The mandate form

**Files:**
- Create: `src/components/mandate-form.tsx`

- [ ] **Step 1: Build the form**

Create `src/components/mandate-form.tsx`. `<input type="date">` has a native value format of exactly `YYYY-MM-DD`, so nothing parses or reformats on either side; the server still validates, because the field can be bypassed.

```tsx
"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";

export function MandateForm({
  action,
  initial,
  submitLabel,
  onCancel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: {
    id: string;
    startDate: string;
    endDate: string | null;
    reason: string | null;
  };
  submitLabel: string;
  onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-3">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            From
          </span>
          <input
            type="date"
            name="startDate"
            required
            defaultValue={initial?.startDate}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            To
          </span>
          <input
            type="date"
            name="endDate"
            defaultValue={initial?.endDate ?? ""}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            Reason
          </span>
          <input
            type="text"
            name="reason"
            maxLength={200}
            placeholder="optional"
            defaultValue={initial?.reason ?? ""}
            className="w-44 border border-rule bg-paper px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="border border-rule px-4 py-2 text-sm hover:bg-ink/5"
          >
            Cancel
          </button>
        )}
      </div>
      <p className="text-xs text-fade">
        Leave <span className="font-mono">To</span> blank for until further
        notice.
      </p>
      {state?.error && (
        <p
          role="alert"
          className="border-l-2 border-stamp pl-3 text-sm text-stamp"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit && npm run lint`

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/mandate-form.tsx
git commit -m "feat: mandate add/edit form"
```

---

## Task 9: Mandates on the settings page

At the end of this task you can create a mandate through the UI, which is what makes Tasks 12–13 verifiable in the real app.

**Files:**
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Query mandates and render the section**

In `src/app/settings/page.tsx`, replace the import block with:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { rtoTargets, wfhMandates } from "@/db/schema";
import { DEFAULT_RTO_PERCENT } from "@/lib/rto";
import { addTargetPeriod } from "@/app/settings-actions";
import { addWfhMandate } from "@/app/mandate-actions";
import { PeriodForm } from "@/components/period-form";
import { PeriodRow } from "@/components/period-row";
import { MandateForm } from "@/components/mandate-form";
import { MandateRow } from "@/components/mandate-row";
```

Add the second query directly below the existing `periods` query:

```tsx
  const mandates = await db
    .select()
    .from(wfhMandates)
    .where(eq(wfhMandates.userId, session.user.id))
    .orderBy(desc(wfhMandates.startDate));
```

Then, inside the existing `<section>`, after the closing `</div>` of the "Add a period" block, add:

```tsx
        <div className="border-t border-rule pt-6">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-fade uppercase">
            Mandated WFH
          </p>
          <p className="mt-2 text-sm text-fade">
            Days the business told everyone to work from home. These are removed
            from eligible working days entirely, so those months carry a smaller
            requirement — or none at all. Leave the end date blank while the
            mandate is open-ended.
          </p>
        </div>

        <div className="border border-rule bg-white/40">
          <div className="border-b border-rule px-4 py-2 font-mono text-[10px] tracking-widest text-fade uppercase">
            Mandates
          </div>
          {mandates.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fade">
              No mandates. Every working day counts toward your requirement.
            </p>
          ) : (
            <ul>
              {mandates.map((m) => (
                <MandateRow
                  key={m.id}
                  id={m.id}
                  mandate={{
                    startDate: m.startDate,
                    endDate: m.endDate,
                    reason: m.reason,
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="border border-rule bg-white/40 p-4">
          <p className="mb-3 font-mono text-[10px] tracking-widest text-fade uppercase">
            Add a mandate
          </p>
          <MandateForm
            key={mandates.length}
            action={addWfhMandate}
            submitLabel="Add mandate"
          />
        </div>
```

**The `key` is not decorative.** `useActionState` does not reset a form, and these inputs are
uncontrolled `defaultValue` ones. Without a key that changes, `revalidatePath` re-renders the
server component but React reconciles this client form at the same position as the same fiber —
so after a successful add the just-submitted dates stay in the fields, and a stray second click
resubmits them straight into the overlap check, producing a baffling "Overlaps an existing
mandate" error on what looks like an idle form. Keying on `mandates.length` remounts the form
only when a row was actually added or removed; a *failed* submit leaves the length unchanged, so
the user keeps their input alongside the error, which is what you want.

**Apply the same one-line fix to the existing period form** while you are in this file — it has
the identical defect today:

```tsx
          <PeriodForm
            key={periods.length}
            action={addTargetPeriod}
            submitLabel="Add period"
          />
```

- [ ] **Step 2: Create the row component**

Create `src/components/mandate-row.tsx`:

```tsx
"use client";

import { useState } from "react";
import { updateWfhMandate } from "@/app/mandate-actions";
import { formatMandateRange, type WfhMandate } from "@/lib/rto";
import { DeleteMandateButton } from "@/components/delete-mandate-button";
import { MandateForm } from "@/components/mandate-form";

export function MandateRow({
  id,
  mandate,
}: {
  id: string;
  mandate: WfhMandate;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="border-b border-rule px-4 py-3 last:border-b-0">
        <MandateForm
          action={updateWfhMandate}
          initial={{
            id,
            startDate: mandate.startDate,
            endDate: mandate.endDate,
            reason: mandate.reason ?? null,
          }}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0">
      <span className="flex flex-col">
        <span className="font-mono text-sm">{formatMandateRange(mandate)}</span>
        {mandate.reason && (
          <span className="text-xs text-fade">{mandate.reason}</span>
        )}
      </span>
      <span className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="border border-rule px-2 py-1 font-mono text-[10px] tracking-widest uppercase hover:bg-ink/5"
        >
          Edit
        </button>
        <DeleteMandateButton id={id} mandate={mandate} />
      </span>
    </li>
  );
}
```

- [ ] **Step 3: Create the delete confirmation**

Create `src/components/delete-mandate-button.tsx`. Deleting a mandate silently returns its days to the eligible pool, which can flip a met month to unmet — so the dialog states that consequence rather than asking a generic "are you sure". Native `<dialog>` gives focus trapping, `Esc`, and the backdrop for free; Cancel is focused so a stray `Enter` does not delete.

```tsx
"use client";

import { useActionState, useEffect, useRef } from "react";
import { deleteWfhMandate } from "@/app/mandate-actions";
import type { ActionState } from "@/lib/action-state";
import {
  countWeekdaysInMandate,
  formatDate,
  formatMandateRange,
  type WfhMandate,
} from "@/lib/rto";

export function DeleteMandateButton({
  id,
  mandate,
}: {
  id: string;
  mandate: WfhMandate;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    deleteWfhMandate,
    null
  );

  // A successful delete removes this row, so only an error keeps us mounted.
  useEffect(() => {
    if (state?.error) dialogRef.current?.close();
  }, [state]);

  const days = countWeekdaysInMandate(mandate);
  const consequence =
    days === null
      ? `Every working day from ${formatDate(mandate.startDate)} onward will count toward your requirement again.`
      : `${days} working ${days === 1 ? "day" : "days"} will count toward your requirement again.`;

  function open() {
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="border border-rule px-2 py-1 font-mono text-[10px] tracking-widest uppercase hover:bg-ink/5"
      >
        Delete
      </button>

      <dialog
        ref={dialogRef}
        className="max-w-sm border border-rule border-t-2 border-t-stamp bg-paper p-5 text-ink backdrop:bg-ink/40"
      >
        <p className="font-semibold">
          Delete the {formatMandateRange(mandate)} mandate?
        </p>
        <p className="mt-2 text-sm">{consequence}</p>
        <form action={formAction} className="mt-4 flex gap-2">
          <input type="hidden" name="id" value={id} />
          <button
            ref={cancelRef}
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="border border-rule px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase hover:bg-ink/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="border border-stamp bg-stamp/10 px-3 py-1.5 font-mono text-[10px] tracking-widest text-stamp uppercase disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Delete mandate"}
          </button>
        </form>
      </dialog>

      {state?.error && (
        <p role="alert" className="text-sm text-stamp">
          {state.error}
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 4: Verify build and behaviour**

Run: `npx tsc --noEmit && npm run lint && npm run build`

Then `npm run dev`, sign in, and open `http://localhost:3000/settings`. Check all of:

1. The Mandated WFH section renders with "No mandates."
2. Add `From 2026-08-12`, To blank, Reason `flood incident` → the row reads `12 Aug 2026 – until further notice` with `flood incident` beneath.
3. Add a second mandate `2026-08-15` → `2026-08-18` → rejected inline with `Overlaps an existing mandate (12 Aug 2026 – until further notice).`
4. Add `2026-03-02` → `2026-03-06` → accepted; rows sort newest start first.
5. Edit the March row, set To `2026-03-01` → rejected with `End date cannot be before the start date.`
6. Delete the March row → the dialog reads `5 working days will count toward your requirement again.`; Cancel leaves it intact, Delete removes it.
7. Open the delete dialog on the open-ended August row → it reads `Every working day from 12 Aug 2026 onward will count toward your requirement again.` Cancel out; **keep this mandate**, Tasks 12–13 need it.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/page.tsx src/components/mandate-row.tsx src/components/delete-mandate-button.tsx
git commit -m "feat: manage WFH mandates from settings"
```

---

## Task 10: Stats copy for mandated months

`mandatedDays` defaults to `0` for every caller until Task 12 passes real mandates, so this task is safe to land on its own: with no mandate the rendered copy is byte-for-byte what it is today.

**Files:**
- Modify: `src/components/stats.tsx`

- [ ] **Step 1: Add the no-requirement state and the mandated clause**

Replace the whole of `src/components/stats.tsx` with:

```tsx
import { DEFAULT_RTO_PERCENT, type MonthStats } from "@/lib/rto";

// Stamp-card meter: one ring per required office day, filled as stamped.
export function Stats({ stats }: { stats: MonthStats }) {
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
      <section aria-label="Monthly progress" className="space-y-2">
        <p className="font-mono text-sm">No requirement — mandated WFH</p>
        <p className="text-sm text-fade">
          {mandatedDays} working {mandatedDays === 1 ? "day" : "days"} this month{" "}
          {mandatedDays === 1 ? "is" : "are"} mandated work from home. No office
          days are required.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Monthly progress" className="space-y-2">
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
            <span className="text-stamp">{remainingNeeded} to go</span>
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
    </section>
  );
}
```

- [ ] **Step 2: Verify no visible change yet**

Run: `npx tsc --noEmit && npm run lint && npm run build`

Then `npm run dev` and load `/`. The stats line must read exactly as before — no mandate reaches `computeMonthStats` until Task 12.

- [ ] **Step 3: Commit**

```bash
git add src/components/stats.tsx
git commit -m "feat: stats copy for mandated months"
```

---

## Task 11: The hatch utility

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add `.mandate-hatch`**

Append to `src/app/globals.css`, below the `@media (prefers-reduced-motion: reduce)` block. This is a utility class beside the existing `.stamp-ring` / `.stamp-in`, not an `@theme` token — the palette already carries the colour it needs.

```css
/* Mandated WFH: a condition imposed on the day, not a status the user chose.
   Hatched rather than badged, and hatched rather than the flat bg-ink/4 that
   weekends use, so the two read as different kinds of "does not count". */
.mandate-hatch {
  background-image: repeating-linear-gradient(
    45deg,
    var(--color-fade) 0,
    var(--color-fade) 1px,
    transparent 1px,
    transparent 6px
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: mandate hatch utility"
```

---

## Task 12: Mandated days in the calendar

**Files:**
- Modify: `src/components/calendar.tsx`

- [ ] **Step 1: Update the imports and `DayMark`**

In `src/components/calendar.tsx`, replace the `@/lib/rto` import with:

```tsx
import {
  computeMonthStats,
  isEligible,
  isMandated,
  isWeekend,
  type DayStatus,
  type Entries,
  type WfhMandate,
} from "@/lib/rto";
```

Then replace `DayMark` with a version that can render muted. A stamp inside a mandate stays on screen — the attendance record survives — but reads plainly as not counted:

```tsx
function DayMark({
  status,
  stamped,
  muted = false,
}: {
  status: DayStatus;
  stamped: boolean;
  muted?: boolean;
}) {
  const mutedClass = muted ? "opacity-40 line-through" : "";
  if (status === "office") {
    return (
      <span
        className={`stamp-ring px-2 py-0.5 font-mono text-[10px] font-semibold tracking-widest uppercase ${
          stamped ? "stamp-in" : ""
        } ${mutedClass}`}
      >
        Office
      </span>
    );
  }
  return (
    <span
      className={`font-mono text-[10px] font-medium tracking-widest uppercase ${
        status === "leave" ? "text-leave" : "text-holiday"
      } ${mutedClass}`}
    >
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Accept the prop and pass it to the stats**

Change the `Calendar` signature to add `mandates`:

```tsx
export function Calendar({
  year,
  month,
  initialEntries,
  targetPercent,
  mandates,
}: {
  year: number;
  month: number;
  initialEntries: Entries;
  targetPercent: number;
  mandates: WfhMandate[];
}) {
```

`mandates` is a plain prop read during render and is deliberately **not** seeded into `useState`. Only `entries` is optimistic; mandates change from `/settings`, which revalidates `/`.

Then change the stats call:

```tsx
  const stats = computeMonthStats(year, month, entries, targetPercent, mandates);
```

- [ ] **Step 3: Route the week badge through `isEligible`**

Replace the three `const` declarations at the top of the `weeks.map` callback:

```tsx
          const weekdays = week.filter(
            (d): d is string => d !== null && !isWeekend(d)
          );
          const eligible = weekdays.filter((d) =>
            isEligible(d, entries, mandates)
          ).length;
          const office = weekdays.filter(
            (d) => isEligible(d, entries, mandates) && entries[d] === "office"
          ).length;
          // The label announces the condition once per row, not the run's bounds
          const firstMandated = weekdays.find((d) => isMandated(d, mandates));
```

`isEligible` is now the single definition of the rule — the badge and `computeMonthStats` cannot drift apart. Note `office` also requires eligibility, so a stamp inside a mandate is excluded here exactly as it is in the month total.

- [ ] **Step 4: Hatch, label, and mute the weekday cell**

Replace the weekday `<button>` block — the whole `const status = entries[date] ?? null;` through the closing `</button>` — with:

```tsx
                const status = entries[date] ?? null;
                const mandated = isMandated(date, mandates);
                return (
                  <button
                    key={di}
                    type="button"
                    onClick={() => cycle(date)}
                    aria-label={
                      mandated
                        ? `${date}: Mandated work from home${
                            status
                              ? `, ${STATUS_LABEL[status]} recorded but not counted`
                              : ""
                          }. Tap to change.`
                        : `${date}: ${STATUS_LABEL[status ?? "wfh"]}. Tap to change.`
                    }
                    className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 p-1.5 transition-colors hover:bg-ink/5 ${
                      di > 0 ? "border-l border-rule" : ""
                    } ${mandated ? "mandate-hatch" : ""}`}
                  >
                    <span
                      className={`absolute top-1.5 left-1.5 font-mono text-xs ${
                        mandated ? "text-fade" : ""
                      } ${
                        date === today
                          ? "-mx-1 -my-0.5 bg-ink px-1 py-0.5 font-semibold text-paper"
                          : ""
                      }`}
                    >
                      {day}
                    </span>
                    {mandated && date === firstMandated && (
                      <span className="font-mono text-[10px] tracking-widest text-fade lowercase">
                        mandated
                      </span>
                    )}
                    {status && (
                      <DayMark
                        status={status}
                        stamped={justStamped === date}
                        muted={mandated}
                      />
                    )}
                  </button>
                );
```

The `mandated` day-number colour is applied before the `today` classes so a mandated today still gets the inverted block.

Cells stay tappable inside a mandate: the status cycle still writes, so a day can be recorded accurately for its own sake, and the mandate overrides it in the maths.

- [ ] **Step 5: Extend the hint line**

Replace the hint paragraph near the bottom of the file:

```tsx
      <p className="text-xs text-fade">
        Tap a weekday to cycle: work from home → office → leave → holiday.
        Untouched days count as work from home. Hatched days are mandated work
        from home — they don&apos;t count toward the requirement.
      </p>
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: one error, in `src/app/page.tsx` — `Property 'mandates' is missing`. That is Task 13. Do not add the prop here.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar.tsx
git commit -m "feat: render mandated days in the calendar"
```

---

## Task 13: Read mandates on the calendar page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Query the mandates intersecting the month**

In `src/app/page.tsx`, replace the drizzle and rto imports:

```tsx
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { dayEntries, rtoTargets, wfhMandates } from "@/db/schema";
import { formatDate, resolvePercent, type Entries } from "@/lib/rto";
```

Then add below the existing `targetPercent` line:

```tsx
  // Only mandates touching this month. The -31 upper bound is the same string
  // comparison trick the day_entries query uses: a bound past the end of a
  // short month is harmless against a fixed-width key.
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
          gte(wfhMandates.endDate, `${monthKey}-01`)
        )
      )
    );
```

- [ ] **Step 2: Render the banner**

Insert directly after the closing `</div>` of the month-title row, still inside `<header>`:

```tsx
        {mandates.length > 0 && (
          <div className="mt-4 space-y-1 border-l-2 border-fade pl-3">
            {mandates.map((m) => (
              <p key={m.id} className="font-mono text-xs text-fade">
                Mandated WFH{" "}
                {m.endDate === null
                  ? `from ${formatDate(m.startDate)} — until further notice`
                  : `${formatDate(m.startDate)} – ${formatDate(m.endDate)}`}
                {m.reason ? ` (${m.reason})` : ""}
              </p>
            ))}
          </div>
        )}
```

No `bg-ink/4` fill: that is the weekend wash, and `globals.css` states the hatch exists
precisely so mandated days do not read like weekends — filling the banner with the weekend
token would reintroduce the confusion one layer up. A left rule alone reads as an aside.
`space-y-1` separates the lines when a month is touched by more than one mandate.

"From", not "since": a mandate can be entered with a future start date, and "since" would be false there. Tense-neutral wording is also the only wording that needs no knowledge of today — which this server render must not have, or SSR output stops being timezone-independent.

- [ ] **Step 3: Pass the prop**

```tsx
      <Calendar
        key={monthKey}
        year={year}
        month={month}
        initialEntries={entries}
        targetPercent={targetPercent}
        mandates={mandates}
      />
```

- [ ] **Step 4: Verify build and behaviour**

Run: `npx tsc --noEmit && npm run lint && npm run build`

Then `npm run dev`, sign in, and — with the open-ended `2026-08-12` mandate from Task 9 still in place — load `http://localhost:3000/?m=2026-08`. Check all of:

1. The banner reads `Mandated WFH from 12 Aug 2026 — until further notice (flood incident)`.
2. The stats line reads `3 office days required — 40% of 7 eligible working days this month · 14 days mandated WFH.`
3. Weekdays from the 12th on are hatched; the 12th shows the lowercase `mandated` label, as does Mon 17, Mon 24, and Mon 31 — one per week row, and no other cell.
4. Weekends still show flat grey, visibly different from the hatch.
5. The `wk` badge reads `0/0` for the week of the 17th, and `0/5` for the week of the 3rd.
6. Tap the 19th to office: the stamp appears faded and struck, the stats line does not move (`3 to go`), and that week's badge stays `0/0`.
7. Tap the 4th to office: the badge for the week of the 3rd reads `1/5`, and `3 to go` becomes `2 to go` — normal behaviour before the mandate.
8. Load `/?m=2026-09` — fully inside the mandate. The ring meter is replaced by `No requirement — mandated WFH` over `22 working days this month are mandated work from home. No office days are required.`
9. Load `/?m=2026-07` — before the mandate. No banner, no hatch, stats read `10 office days required — 40% of 23 eligible working days this month.` with no mandated clause. (July 2026 has 23 weekdays, and `ceil(23 × 40 / 100) = 10`.)
10. Delete the mandate in `/settings`, return to `/?m=2026-08`, and confirm the month reverts to 21 eligible / 9 required with no banner. Then re-add it if you want it for manual review.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: apply WFH mandates to the calendar month"
```

---

## Task 14: Documentation

**Files:**
- Create: `docs/decisions/0003-mandated-wfh-exclusions.md`
- Modify: `CLAUDE.md:48`, `docs/architecture.md:33`, `README.md:5`

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0003-mandated-wfh-exclusions.md`, matching the Context / Decision / Consequences shape of `0002`:

```markdown
# 0003 — Mandated WFH as day-range exclusions

## Context

Following an incident, management directed everyone to work from home from a
given date until further notice. Those weekdays carry no office obligation and
must not count toward the monthly requirement.

Nothing existing expressed it. Tapping days as `leave` or `holiday` records the
wrong reason, and an open-ended range has no finite set of days to tap. A 0%
`rto_targets` period is month-granular, so it cannot express "from 12 August",
and it would report a misleading achieved percentage against days that were
never owed.

## Decision

Store mandates as **inclusive day ranges** — `(start_date, end_date)` per user,
`end_date` NULL meaning until further notice — in their own `wfh_mandates`
table, and drop mandated weekdays from the eligible pool exactly as holidays
are dropped.

Rejected alternatives:

- **A 0% target period.** Month granularity cannot split the month the mandate
  began in, and it conflates *what percent applies* with *which days count*.
  Sharing `rto_targets`' overlap check would also forbid a mandate inside a 20%
  period, which is the real case.
- **A fourth `day_status` enum value.** Reuses the whole day-entry pipeline, but
  "until further notice" has no end, so rows could only be materialised lazily
  as months are visited — a write during a server render. It also cannot hold an
  `office` stamp and a mandate on the same day.

## Consequences

- A partial month prorates for free: a mandate from 12 Aug 2026 leaves 7 of
  August's 21 weekdays eligible, so 3 office days are required instead of 9.
- A mandate beats any recorded status. An `office` stamp inside the window is
  kept as a record and rendered, but excluded from `officeDays`, so
  `officeDays ≤ eligibleDays` holds and `achievedPercent` cannot exceed 100.
- A mandated day that is also marked leave is counted once, as mandated.
- Dates are `YYYY-MM-DD` text, so all range logic is pure string comparison —
  the same reasoning as month keys in 0002 and day keys throughout.
- Overlaps are rejected at write time; gaps are normal.
- `eligibleDays === 0` now has two causes, so `mandatedDays` is reported to
  distinguish "all leave" from "fully mandated" in the UI copy.
- Deleting a mandate silently returns its days to the eligible pool and can flip
  a met month to unmet, so deletion is confirmed with the affected weekday count.
```

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the sentence at `CLAUDE.md:48`:

```
Eligible days = weekdays − holidays − leaves. Required = `ceil(eligible × targetPercent / 100)`
```

with:

```
Eligible days = weekdays − mandated − holidays − leaves. Required =
`ceil(eligible × targetPercent / 100)`
```

Then add a new paragraph after the "The target rate is per date range" paragraph:

```
**Mandated WFH days are excluded outright.** `wfh_mandates` holds inclusive day ranges
(`start_date`, `end_date`) per user; `end_date` NULL means until further notice. Dates are
`YYYY-MM-DD` **text**, so range checks are pure string comparisons — the same reasoning as
month keys. Overlaps are rejected in `mandate-actions.ts`. A mandate wins over anything in
`day_entries`: `isEligible` checks it first, so an `office` stamp inside a mandate is still
rendered (faded, as a record) but excluded from `officeDays` — which is what keeps
`officeDays ≤ eligibleDays` and `achievedPercent ≤ 100`. `MonthStats.mandatedDays` exists
because `eligibleDays === 0` now has two causes and the copy differs between them.
```

- [ ] **Step 3: Update `docs/architecture.md`**

Replace line 33:

```
- Eligible working days in a month = weekdays − holidays − leaves
```

with:

```
- Eligible working days in a month = weekdays − mandated WFH − holidays − leaves
- Mandated WFH days come from `wfh_mandates` day ranges, not from `day_entries`, and
  take precedence over any recorded status
```

- [ ] **Step 4: Update `README.md`**

Replace line 5:

```
Unmarked weekdays count as work from home; leaves and holidays are excluded
```

with:

```
Unmarked weekdays count as work from home; leaves, holidays, and mandated
work-from-home periods are excluded
```

And append to the settings paragraph around line 48:

```
Business-mandated work-from-home periods go in the same place, as date ranges —
leave the end date blank while the mandate is open-ended.
```

- [ ] **Step 5: Full verification**

Run: `npm test && npm run lint && npm run build`

Expected: `Tests 78 passed (78)`, lint clean, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0003-mandated-wfh-exclusions.md CLAUDE.md docs/architecture.md README.md
git commit -m "docs: document mandated WFH exclusions"
```

---

## Done criteria

- [ ] `npm test` → `Tests 78 passed (78)`
- [ ] `npm run lint` → clean
- [ ] `npm run build` → succeeds
- [ ] `npx tsc --noEmit` → clean
- [ ] With an open-ended mandate from `2026-08-12`: August 2026 reads 7 eligible / 3 required, September reads `No requirement — mandated WFH`, July is untouched
- [ ] An `office` stamp inside a mandate renders faded and struck and moves no number
- [ ] Deleting the mandate restores August to 21 eligible / 9 required
- [ ] No file imports `ActionState` from `@/app/settings-actions`

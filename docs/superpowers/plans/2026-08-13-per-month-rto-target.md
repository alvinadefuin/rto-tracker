# Per-Month RTO Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the monthly RTO requirement configurable per date range, so historical months are scored against the rate that actually applied, and future changes need no redeploy.

**Architecture:** A new `rto_targets` table stores closed periods (`start_month`, `end_month`, `percent`) per user; months matching no period fall back to a `DEFAULT_RTO_PERCENT` code constant. All range logic is pure string comparison on `YYYY-MM` keys in `src/lib/rto.ts`, so it is unit-testable in the existing node environment and constructs no `Date`. A `/settings` route manages periods through server actions that reject overlapping ranges.

**Tech Stack:** Next.js 16 (App Router), React 19, Drizzle ORM, Neon Postgres, Auth.js v5, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-per-month-rto-target-design.md`

---

## Before you start

Read `CLAUDE.md` and `AGENTS.md` in the repo root. Two invariants govern every task here:

1. **Dates are text, never `Date`.** Day keys are `YYYY-MM-DD`, month keys are `YYYY-MM`. Both are zero-padded and fixed-width, so `<=` and `>=` on the strings are correct calendar comparisons. Never parse a date string through `new Date("2026-01-05")` — it goes through the local timezone and shifts the day.
2. **`src/lib/rto.ts` is pure and isomorphic.** Both the server (`page.tsx`) and the client (`calendar.tsx`) call `computeMonthStats`. It must not touch the database, the network, or the clock.

Local dev points at the Neon **`dev`** branch, not production. Verify before Task 5:

```bash
grep -c 'ep-flat-unit-azuxnnpa' .env.local   # expect: 1
```

If that prints `0`, stop and ask — you may be pointed at production, and Task 5 pushes schema.

Run the test suite once to confirm a green baseline:

```bash
npm test
```

Expected: `Test Files 1 passed (1)`, `Tests 8 passed (8)`.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/app/settings-actions.ts` | Server actions for period CRUD; validation and overlap rejection |
| `src/app/settings/page.tsx` | Settings route: lists periods, hosts the add form |
| `src/components/period-form.tsx` | Client. One form used for both add and edit, via `useActionState` |
| `src/components/period-row.tsx` | Client. One period row; owns the view/edit toggle |
| `src/components/delete-period-button.tsx` | Client. Delete confirmation `<dialog>` |
| `docs/decisions/0002-per-month-targets.md` | ADR recording the closed-period choice |

**Modify:**

| File | Change |
|---|---|
| `src/lib/rto.ts` | Add `DEFAULT_RTO_PERCENT`, `TargetPeriod`, `resolvePercent`, `periodsOverlap`, `countMonthsInPeriod`, `formatMonth`, `formatPeriodRange`; `computeMonthStats` gains a target param; `MonthStats` field changes; remove `RTO_TARGET` |
| `src/lib/rto.test.ts` | New describes; three existing `s.percent` assertions updated |
| `src/db/schema.ts` | Add `rtoTargets` table; add `index` to the `pg-core` import |
| `src/app/page.tsx` | Query periods, resolve the month's rate, pass it down, add Settings link |
| `src/components/calendar.tsx` | Accept and forward `targetPercent` |
| `src/components/stats.tsx` | Render `targetPercent` and `achievedPercent` instead of hardcoded 40% |
| `src/app/signin/page.tsx` | Remove the hardcoded 40% from unauthenticated copy |
| `CLAUDE.md`, `README.md`, `docs/architecture.md` | Document the new behaviour |

Components are split so each holds one responsibility and stays small enough to reason about: the form knows nothing about rows, the row knows nothing about dialogs, and the dialog knows nothing about validation.

---

## Task 1: Target periods and rate resolution

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("resolvePercent", () => {
  const closed: TargetPeriod[] = [
    { startMonth: "2022-06", endMonth: "2023-12", percent: 20 },
  ];

  it("returns the period percent for a month inside it", () => {
    expect(resolvePercent("2023-03", closed)).toBe(20);
  });

  it("includes both boundary months", () => {
    expect(resolvePercent("2022-06", closed)).toBe(20);
    expect(resolvePercent("2023-12", closed)).toBe(20);
  });

  it("falls back to the default before and after the period", () => {
    expect(resolvePercent("2022-05", closed)).toBe(DEFAULT_RTO_PERCENT);
    expect(resolvePercent("2024-01", closed)).toBe(DEFAULT_RTO_PERCENT);
  });

  it("treats a null endMonth as ongoing", () => {
    const ongoing: TargetPeriod[] = [
      { startMonth: "2026-08", endMonth: null, percent: 25 },
    ];
    expect(resolvePercent("2026-08", ongoing)).toBe(25);
    expect(resolvePercent("2099-01", ongoing)).toBe(25);
    expect(resolvePercent("2026-07", ongoing)).toBe(DEFAULT_RTO_PERCENT);
  });

  it("falls back to the default when there are no periods", () => {
    expect(resolvePercent("2026-08", [])).toBe(DEFAULT_RTO_PERCENT);
  });
});
```

Update the import on line 2 of the same file to:

```ts
import {
  computeMonthStats,
  monthWeekdays,
  isWeekend,
  resolvePercent,
  DEFAULT_RTO_PERCENT,
  type TargetPeriod,
} from "./rto";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: FAIL. TypeScript/import error — `resolvePercent`, `DEFAULT_RTO_PERCENT`, and `TargetPeriod` are not exported from `./rto`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/rto.ts`, replace the line `export const RTO_TARGET = 0.4;` with:

```ts
/** Whole percent required when no configured period covers a month. */
export const DEFAULT_RTO_PERCENT = 40;

/**
 * Stand-in for "no end month". Same fixed width as a real YYYY-MM key, so
 * comparisons stay pure string compares and no Date is ever constructed.
 */
const OPEN_ENDED = "9999-12";

export interface TargetPeriod {
  startMonth: string; // YYYY-MM, inclusive
  endMonth: string | null; // YYYY-MM inclusive, or null when ongoing
  percent: number; // whole percent, 0..100
}

/** Whole percent in effect for `monthKey` (YYYY-MM). */
export function resolvePercent(
  monthKey: string,
  periods: TargetPeriod[]
): number {
  const hit = [...periods]
    .sort((a, b) => a.startMonth.localeCompare(b.startMonth))
    .find(
      (p) =>
        monthKey >= p.startMonth && monthKey <= (p.endMonth ?? OPEN_ENDED)
    );
  return hit ? hit.percent : DEFAULT_RTO_PERCENT;
}
```

Leaving `RTO_TARGET` removed will break line 80 of the same file. Change that line from:

```ts
  const requiredDays = Math.ceil(RTO_TARGET * eligibleDays);
```

to a temporary form that keeps behaviour identical until Task 4:

```ts
  const requiredDays = Math.ceil((eligibleDays * DEFAULT_RTO_PERCENT) / 100);
```

Also update the `requiredDays` comment in the `MonthStats` interface from `// ceil(0.4 * eligibleDays)` to `// ceil(eligibleDays * targetPercent / 100)`.

The sort makes the result deterministic even if an overlapping row somehow reaches the database. Overlaps are rejected at write time in Task 7, so at most one period should ever match.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS, 13 tests (8 existing + 5 new).

- [ ] **Step 5: Verify nothing else referenced `RTO_TARGET`**

Run: `grep -rn "RTO_TARGET" src/ | grep -v "DEFAULT_RTO_PERCENT"`
Expected: no output. If anything prints, update that call site to `DEFAULT_RTO_PERCENT` before committing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: resolve monthly RTO rate from target periods"
```

---

## Task 2: Overlap detection

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("periodsOverlap", () => {
  const p = (
    startMonth: string,
    endMonth: string | null,
    percent = 20
  ): TargetPeriod => ({ startMonth, endMonth, percent });

  it("is true for identical periods", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2022-06", "2023-12"))).toBe(
      true
    );
  });

  it("is true when they share exactly one boundary month", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2023-12", "2024-06"))).toBe(
      true
    );
  });

  it("is false for adjacent periods that do not touch", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2024-01", "2024-06"))).toBe(
      false
    );
  });

  it("is true when an ongoing period starts before the other ends", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2023-01", null))).toBe(true);
  });

  it("is false when an ongoing period starts after the other ends", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2024-01", null))).toBe(
      false
    );
  });

  it("is true when both are ongoing", () => {
    expect(periodsOverlap(p("2022-06", null), p("2030-01", null))).toBe(true);
  });

  it("is order-independent", () => {
    const a = p("2022-06", "2023-12");
    const b = p("2023-01", null);
    expect(periodsOverlap(a, b)).toBe(periodsOverlap(b, a));
  });
});
```

Add `periodsOverlap` to the import list at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: FAIL — `periodsOverlap` is not exported from `./rto`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/rto.ts`, after `resolvePercent`:

```ts
/** True when two periods share at least one month. */
export function periodsOverlap(a: TargetPeriod, b: TargetPeriod): boolean {
  return (
    a.startMonth <= (b.endMonth ?? OPEN_ENDED) &&
    b.startMonth <= (a.endMonth ?? OPEN_ENDED)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: detect overlapping target periods"
```

---

## Task 3: Month counting and display formatting

These exist for the delete confirmation copy and the settings rows. Both are pure so the dialog needs no extra query.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("countMonthsInPeriod", () => {
  it("counts inclusive months for a closed period", () => {
    expect(
      countMonthsInPeriod({
        startMonth: "2022-06",
        endMonth: "2023-12",
        percent: 20,
      })
    ).toBe(19);
  });

  it("counts a single-month period as 1", () => {
    expect(
      countMonthsInPeriod({
        startMonth: "2022-06",
        endMonth: "2022-06",
        percent: 20,
      })
    ).toBe(1);
  });

  it("counts across a year boundary", () => {
    expect(
      countMonthsInPeriod({
        startMonth: "2022-11",
        endMonth: "2023-02",
        percent: 20,
      })
    ).toBe(4);
  });

  it("returns null for an ongoing period", () => {
    expect(
      countMonthsInPeriod({
        startMonth: "2022-06",
        endMonth: null,
        percent: 20,
      })
    ).toBeNull();
  });
});

describe("formatMonth", () => {
  it("renders a YYYY-MM key as an abbreviated month and year", () => {
    expect(formatMonth("2022-06")).toBe("Jun 2022");
    expect(formatMonth("2023-12")).toBe("Dec 2023");
    expect(formatMonth("2026-01")).toBe("Jan 2026");
  });
});

describe("formatPeriodRange", () => {
  it("renders a closed period as a range", () => {
    expect(
      formatPeriodRange({
        startMonth: "2022-06",
        endMonth: "2023-12",
        percent: 20,
      })
    ).toBe("Jun 2022 – Dec 2023");
  });

  it("marks an ongoing period", () => {
    expect(
      formatPeriodRange({
        startMonth: "2022-06",
        endMonth: null,
        percent: 20,
      })
    ).toBe("Jun 2022 – ongoing");
  });
});
```

Add `countMonthsInPeriod`, `formatMonth`, and `formatPeriodRange` to the import list.

Note the separator in the expected strings is an en dash (`–`, U+2013), not a hyphen.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: FAIL — the three functions are not exported from `./rto`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/rto.ts`, after `periodsOverlap`:

```ts
const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Months a closed period covers, inclusive. `null` when the period is ongoing —
 * returning null rather than a number forces callers to handle the unbounded
 * case instead of quietly rendering a wrong count.
 */
export function countMonthsInPeriod(period: TargetPeriod): number | null {
  if (period.endMonth === null) return null;
  const [sy, sm] = period.startMonth.split("-").map(Number);
  const [ey, em] = period.endMonth.split("-").map(Number);
  return ey * 12 + em - (sy * 12 + sm) + 1;
}

/** "2022-06" → "Jun 2022". */
export function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_ABBR[month - 1]} ${year}`;
}

/** "Jun 2022 – Dec 2023", or "Jun 2022 – ongoing" when open-ended. */
export function formatPeriodRange(period: TargetPeriod): string {
  const end =
    period.endMonth === null ? "ongoing" : formatMonth(period.endMonth);
  return `${formatMonth(period.startMonth)} – ${end}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS, 27 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: count and format target periods"
```

---

## Task 4: Compute stats at a given rate

This task changes a public shape. `MonthStats.percent` (a `0..1` fraction) becomes `MonthStats.achievedPercent` (a whole number), and a new `targetPercent` carries the required rate. `stats.tsx` and three existing test assertions must change in the same commit so the build never goes red.

**Files:**
- Modify: `src/lib/rto.ts`
- Modify: `src/components/stats.tsx`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Update the three existing assertions and add new ones**

In `src/lib/rto.test.ts`, make exactly these three replacements inside the existing `describe("computeMonthStats")`:

| Existing line | Replace with |
|---|---|
| `expect(s.percent).toBe(0);` (in "empty month") | `expect(s.achievedPercent).toBe(0);` |
| `expect(s.percent).toBeCloseTo(2 / 22);` | `expect(s.achievedPercent).toBe(9); // round(9.09)` |
| `expect(s.percent).toBe(0); // no divide-by-zero` | `expect(s.achievedPercent).toBe(0); // no divide-by-zero` |

The middle one changes value as well as name: `Math.round((2 / 22) * 100)` is `9`.

Then append a new describe:

```ts
describe("computeMonthStats target rate", () => {
  it("defaults to the 40% requirement", () => {
    const s = computeMonthStats(2026, 1, {});
    expect(s.targetPercent).toBe(DEFAULT_RTO_PERCENT);
    expect(s.requiredDays).toBe(9); // ceil(22 * 40 / 100)
  });

  it("applies an explicit reduced rate", () => {
    const s = computeMonthStats(2026, 1, {}, 20);
    expect(s.targetPercent).toBe(20);
    expect(s.requiredDays).toBe(5); // ceil(4.4)
    expect(s.remainingNeeded).toBe(5);
  });

  it("treats a 0% rate as no requirement", () => {
    const s = computeMonthStats(2026, 1, {}, 0);
    expect(s.requiredDays).toBe(0);
    expect(s.remainingNeeded).toBe(0);
  });

  it("reports achievedPercent as a whole number", () => {
    const s = computeMonthStats(2026, 1, { "2026-01-05": "office" });
    expect(s.achievedPercent).toBe(5); // round(1/22 * 100) = 5
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: FAIL — `achievedPercent` and `targetPercent` are `undefined` on `MonthStats`.

- [ ] **Step 3: Update `MonthStats` and `computeMonthStats`**

In `src/lib/rto.ts`, replace the `percent` line in the `MonthStats` interface:

```ts
  percent: number; // officeDays / eligibleDays (0 when eligibleDays === 0)
```

with these two:

```ts
  targetPercent: number; // whole percent required this month, e.g. 20
  achievedPercent: number; // whole percent achieved, 0 when eligibleDays === 0
```

Change the signature to take the rate:

```ts
export function computeMonthStats(
  year: number,
  month: number,
  entries: Entries,
  targetPercent: number = DEFAULT_RTO_PERCENT
): MonthStats {
```

And replace the return block at the end of the function:

```ts
  const requiredDays = Math.ceil((eligibleDays * targetPercent) / 100);
  return {
    eligibleDays,
    officeDays,
    requiredDays,
    remainingNeeded: Math.max(0, requiredDays - officeDays),
    targetPercent,
    achievedPercent:
      eligibleDays === 0 ? 0 : Math.round((officeDays / eligibleDays) * 100),
    weeks,
  };
```

Resolution deliberately stays *outside* this function — "which rate applies" and "compute at a rate" are separate concerns, separately tested.

- [ ] **Step 4: Update `stats.tsx` to the new fields**

Replace the whole body of `src/components/stats.tsx` with:

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
  } = stats;
  const filled = Math.min(officeDays, requiredDays);
  const extra = officeDays - filled;

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
        .
      </p>
    </section>
  );
}
```

The "(adjusted from 40%)" wording is direction-neutral on purpose — it reads correctly for a rate above the default as well as below, which "reduced" would not.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, 31 tests, and `tsc` silent.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts src/components/stats.tsx
git commit -m "feat: compute required days from a per-month target rate"
```

---

## Task 5: The `rto_targets` table

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Confirm you are on the dev database**

Run: `grep -c 'ep-flat-unit-azuxnnpa' .env.local`
Expected: `1`. If `0`, STOP — do not push schema to production.

- [ ] **Step 2: Add the table**

In `src/db/schema.ts`, add `index` to the `drizzle-orm/pg-core` import so it reads:

```ts
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
```

Then append at the end of the file:

```ts
export const rtoTargets = pgTable(
  "rto_targets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startMonth: text("start_month").notNull(), // YYYY-MM inclusive; text avoids TZ drift
    endMonth: text("end_month"), // YYYY-MM inclusive, or NULL when ongoing
    percent: integer("percent").notNull(), // whole percent, 0..100
  },
  (t) => [index("rto_targets_user_start_idx").on(t.userId, t.startMonth)]
);
```

- [ ] **Step 3: Push the schema**

Run: `npx drizzle-kit push`
Expected: completes with `[✓] Changes applied`.

Note: `drizzle-kit push` prints `Changes applied` unconditionally, including on no-ops. It is not proof anything changed — Step 4 is the actual check.

- [ ] **Step 4: Verify the table exists and is empty**

Run (this exact command is verified to work in this repo):

```bash
node -e "require('dotenv').config({path:'.env.local',quiet:true});import('@neondatabase/serverless').then(async({neon})=>{const sql=neon(process.env.DATABASE_URL);console.log(await sql\`SELECT count(*)::int AS rows FROM rto_targets\`)}).catch(e=>{console.error('FAILED:',e.message);process.exit(1)})"
```

Expected: `[ { rows: 0 } ]`.

If it prints `FAILED: relation "rto_targets" does not exist`, the push in Step 3 did not apply — do not continue to Task 6.

Zero rows is the point: every month still resolves to 40%, so behaviour is identical to before this feature until a period is added.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add rto_targets table"
```

---

## Task 6: Read the rate on the calendar page

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/calendar.tsx`

- [ ] **Step 1: Query periods and resolve the rate**

In `src/app/page.tsx`, extend the schema import and the rto import:

```ts
import { dayEntries, rtoTargets } from "@/db/schema";
import { resolvePercent, type Entries } from "@/lib/rto";
```

After the existing `rows` query, add:

```ts
  const periodRows = await db
    .select({
      startMonth: rtoTargets.startMonth,
      endMonth: rtoTargets.endMonth,
      percent: rtoTargets.percent,
    })
    .from(rtoTargets)
    .where(eq(rtoTargets.userId, session.user.id));

  const targetPercent = resolvePercent(monthKey, periodRows);
```

No cast is needed: selecting exactly those three columns yields `{ startMonth: string; endMonth: string | null; percent: number }[]`, which already matches `TargetPeriod[]`. If you find yourself adding `as TargetPeriod[]`, you selected the wrong columns.

The table holds a handful of rows per user, so fetching all of them is cheaper than filtering by month in SQL.

- [ ] **Step 2: Pass the rate to `<Calendar>`**

Replace the existing `<Calendar ... />` element with:

```tsx
      {/* Keyed by month: search-param navigation re-renders rather than
          remounts, and Calendar seeds its state from initialEntries only on
          mount. Without the key, sliding months keeps the previous month's
          entries and the new month renders blank. */}
      <Calendar
        key={monthKey}
        year={year}
        month={month}
        initialEntries={entries}
        targetPercent={targetPercent}
      />
```

- [ ] **Step 3: Accept and forward the prop**

In `src/components/calendar.tsx`, change the component signature to:

```tsx
export function Calendar({
  year,
  month,
  initialEntries,
  targetPercent,
}: {
  year: number;
  month: number;
  initialEntries: Entries;
  targetPercent: number;
}) {
```

And change the stats line from `const stats = computeMonthStats(year, month, entries);` to:

```tsx
  const stats = computeMonthStats(year, month, entries, targetPercent);
```

`targetPercent` is a plain prop read during render, so it tracks month navigation correctly whether or not the `key` remount fires.

- [ ] **Step 4: Verify the build and behaviour**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: `tsc` silent, 31 tests pass, build succeeds with `/` still listed as `ƒ (Dynamic)`.

Then run `npm run dev` and load `http://localhost:3000`. With no rows in `rto_targets`, the stats line must read exactly as before — `N office days required — 40% of M eligible working days this month.` with no "(adjusted from…)" suffix.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/calendar.tsx
git commit -m "feat: apply the resolved target rate to the calendar"
```

---

## Task 7: Server actions for periods

**Files:**
- Create: `src/app/settings-actions.ts`

No unit tests here: the only logic worth testing is the overlap rule, already covered in Task 2. These actions are thin validation wrappers over it. Verification is typecheck plus the manual checks in Task 8.

- [ ] **Step 1: Write the actions**

Create `src/app/settings-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { rtoTargets } from "@/db/schema";
import {
  formatPeriodRange,
  periodsOverlap,
  type TargetPeriod,
} from "@/lib/rto";

export type ActionState = { error?: string } | null;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Validation failures return a message; auth failures throw. */
function parse(formData: FormData):
  | { ok: true; period: TargetPeriod }
  | { ok: false; error: string } {
  const startMonth = String(formData.get("startMonth") ?? "");
  const rawEnd = String(formData.get("endMonth") ?? "").trim();
  const endMonth = rawEnd === "" ? null : rawEnd;
  const percent = Number(formData.get("percent"));

  if (!MONTH_RE.test(startMonth)) {
    return { ok: false, error: "Start month must be a valid month." };
  }
  if (endMonth !== null && !MONTH_RE.test(endMonth)) {
    return { ok: false, error: "End month must be a valid month, or blank." };
  }
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: "Percent must be a whole number from 0 to 100." };
  }
  if (endMonth !== null && endMonth < startMonth) {
    return { ok: false, error: "End month cannot be before the start month." };
  }
  return { ok: true, period: { startMonth, endMonth, percent } };
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

/** Returns an error message when `period` collides with an existing row. */
async function overlapError(
  userId: string,
  period: TargetPeriod,
  excludeId?: string
): Promise<string | null> {
  const existing = await db
    .select({
      startMonth: rtoTargets.startMonth,
      endMonth: rtoTargets.endMonth,
      percent: rtoTargets.percent,
    })
    .from(rtoTargets)
    .where(
      excludeId
        ? and(eq(rtoTargets.userId, userId), ne(rtoTargets.id, excludeId))
        : eq(rtoTargets.userId, userId)
    );

  const clash = existing.find((e) => periodsOverlap(e, period));
  if (!clash) return null;
  return `Overlaps an existing period (${formatPeriodRange(clash)}, ${clash.percent}%).`;
}

function revalidate() {
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function addTargetPeriod(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const clash = await overlapError(userId, parsed.period);
  if (clash) return { error: clash };

  await db.insert(rtoTargets).values({ userId, ...parsed.period });
  revalidate();
  return null;
}

export async function updateTargetPeriod(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing period id." };

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const clash = await overlapError(userId, parsed.period, id);
  if (clash) return { error: clash };

  // Scoped by userId so one user cannot address another's row by guessing an id.
  await db
    .update(rtoTargets)
    .set(parsed.period)
    .where(and(eq(rtoTargets.id, id), eq(rtoTargets.userId, userId)));
  revalidate();
  return null;
}

export async function deleteTargetPeriod(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing period id." };

  await db
    .delete(rtoTargets)
    .where(and(eq(rtoTargets.id, id), eq(rtoTargets.userId, userId)));
  revalidate();
  return null;
}
```

Both `revalidatePath` calls are required: the settings list must reflect the change, and the calendar's required-day count depends on it.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit && npm run lint`
Expected: both silent.

- [ ] **Step 3: Commit**

```bash
git add src/app/settings-actions.ts
git commit -m "feat: server actions for RTO target periods"
```

---

## Task 8: Settings page with the add form

**Files:**
- Create: `src/components/period-form.tsx`
- Create: `src/app/settings/page.tsx`

- [ ] **Step 1: Build the form component**

Create `src/components/period-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/settings-actions";

export function PeriodForm({
  action,
  initial,
  submitLabel,
  onCancel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: { id: string; startMonth: string; endMonth: string | null; percent: number };
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
            type="month"
            name="startMonth"
            required
            defaultValue={initial?.startMonth}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            To
          </span>
          <input
            type="month"
            name="endMonth"
            defaultValue={initial?.endMonth ?? ""}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            Percent
          </span>
          <input
            type="number"
            name="percent"
            min={0}
            max={100}
            step={1}
            required
            defaultValue={initial?.percent}
            className="w-24 border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
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
        Leave <span className="font-mono">To</span> blank for an ongoing period.
      </p>
      {state?.error && (
        <p role="alert" className="border-l-2 border-stamp pl-3 text-sm text-stamp">
          {state.error}
        </p>
      )}
    </form>
  );
}
```

`<input type="month">` produces exactly `YYYY-MM`, so nothing parses or reformats. The server still validates the shape — the field can be bypassed.

- [ ] **Step 2: Build the settings page**

Create `src/app/settings/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { rtoTargets } from "@/db/schema";
import { DEFAULT_RTO_PERCENT, formatPeriodRange } from "@/lib/rto";
import { addTargetPeriod } from "@/app/settings-actions";
import { PeriodForm } from "@/components/period-form";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const periods = await db
    .select()
    .from(rtoTargets)
    .where(eq(rtoTargets.userId, session.user.id))
    .orderBy(desc(rtoTargets.startMonth));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-fade uppercase">
            RTO requirement
          </p>
          <Link
            href="/"
            className="font-mono text-[11px] tracking-[0.2em] text-fade uppercase underline-offset-4 hover:text-ink hover:underline"
          >
            Calendar
          </Link>
        </div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          Settings
        </h1>
      </header>

      <section className="space-y-6">
        <p className="text-sm text-fade">
          Default requirement is{" "}
          <span className="font-mono text-ink">{DEFAULT_RTO_PERCENT}%</span> of
          eligible working days. Add a period below to override it for a range of
          months — anything outside a period uses the default.
        </p>

        <div className="border border-rule bg-white/40">
          <div className="border-b border-rule px-4 py-2 font-mono text-[10px] tracking-widest text-fade uppercase">
            Periods
          </div>
          {periods.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fade">
              No periods yet. Every month uses the {DEFAULT_RTO_PERCENT}% default.
            </p>
          ) : (
            <ul>
              {periods.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
                >
                  <span className="font-mono text-sm">
                    {formatPeriodRange(p)}
                  </span>
                  <span className="font-mono text-sm font-semibold text-stamp">
                    {p.percent}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-rule bg-white/40 p-4">
          <p className="mb-3 font-mono text-[10px] tracking-widest text-fade uppercase">
            Add a period
          </p>
          <PeriodForm action={addTargetPeriod} submitLabel="Add period" />
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Verify build and behaviour**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all silent/successful, with `/settings` listed as `ƒ (Dynamic)`.

Then with `npm run dev`, at `http://localhost:3000/settings`:

1. Empty state reads "No periods yet."
2. Add `2022-06` → `2023-12` at `20`. The row appears as `Jun 2022 – Dec 2023  20%`.
3. Add `2023-01` → `2023-06` at `30`. Expect the inline error: `Overlaps an existing period (Jun 2022 – Dec 2023, 20%).`
4. Add `2024-01` → blank at `25`. Row appears as `Jan 2024 – ongoing  25%`.
5. Add start `2025-01` → end `2024-01`. Expect `End month cannot be before the start month.`
6. Navigate to `/?m=2023-03`. The stats line must now read `20% of N eligible working days this month (adjusted from 40%)`.

Step 6 is the whole point of the feature — do not skip it.

- [ ] **Step 4: Commit**

```bash
git add src/components/period-form.tsx src/app/settings/page.tsx
git commit -m "feat: settings page for RTO target periods"
```

---

## Task 9: Delete with a confirmation dialog

Deleting is not a local edit: the months a period covered stop matching anything and get rescored at the default, so months that met a reduced target can flip back to unmet with no notice. The dialog therefore states the consequence instead of asking a generic "are you sure".

**Files:**
- Create: `src/components/delete-period-button.tsx`

- [ ] **Step 1: Build the dialog component**

Create `src/components/delete-period-button.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useRef } from "react";
import { deleteTargetPeriod, type ActionState } from "@/app/settings-actions";
import {
  DEFAULT_RTO_PERCENT,
  countMonthsInPeriod,
  formatMonth,
  formatPeriodRange,
  type TargetPeriod,
} from "@/lib/rto";

export function DeletePeriodButton({
  id,
  period,
}: {
  id: string;
  period: TargetPeriod;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    deleteTargetPeriod,
    null
  );

  // A successful delete removes this row, so only an error keeps us mounted.
  useEffect(() => {
    if (state?.error) dialogRef.current?.close();
  }, [state]);

  const months = countMonthsInPeriod(period);
  const consequence =
    months === null
      ? `Every month from ${formatMonth(period.startMonth)} onward will revert to the default ${DEFAULT_RTO_PERCENT}% requirement.`
      : `${months} ${months === 1 ? "month" : "months"} will revert to the default ${DEFAULT_RTO_PERCENT}% requirement.`;

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
          Delete the {formatPeriodRange(period)} period?
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
            {pending ? "Deleting…" : "Delete period"}
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

Native `<dialog>` + `showModal()` gives focus trapping, `Esc` to dismiss, and the backdrop with no library. Cancel takes focus on open, so a stray `Enter` does not delete. The month count comes from the pure helper, so no extra query is needed.

- [ ] **Step 2: Render it in the list**

In `src/app/settings/page.tsx`, add the import:

```ts
import { DeletePeriodButton } from "@/components/delete-period-button";
```

and replace the percent `<span>` inside the `<li>` with:

```tsx
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-stamp">
                      {p.percent}%
                    </span>
                    <DeletePeriodButton id={p.id} period={p} />
                  </span>
```

- [ ] **Step 3: Verify behaviour**

Run: `npx tsc --noEmit && npm run build`
Expected: silent / successful.

With `npm run dev`, on `/settings`:

1. Click Delete on `Jun 2022 – Dec 2023`. The dialog must read `19 months will revert to the default 40% requirement.`
2. Press `Esc` — dialog closes, row still present.
3. Click Delete on the ongoing `Jan 2024 – ongoing` row. Copy must read `Every month from Jan 2024 onward will revert to the default 40% requirement.`
4. Confirm the delete. Row disappears.
5. Load `/?m=2024-03` — stats must be back to `40%` with no "(adjusted…)" suffix.

- [ ] **Step 4: Commit**

```bash
git add src/components/delete-period-button.tsx src/app/settings/page.tsx
git commit -m "feat: confirm period deletion with its month impact"
```

---

## Task 10: Inline editing

**Files:**
- Create: `src/components/period-row.tsx`
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Build the row component**

Create `src/components/period-row.tsx`:

```tsx
"use client";

import { useState } from "react";
import { updateTargetPeriod } from "@/app/settings-actions";
import { formatPeriodRange, type TargetPeriod } from "@/lib/rto";
import { DeletePeriodButton } from "@/components/delete-period-button";
import { PeriodForm } from "@/components/period-form";

export function PeriodRow({
  id,
  period,
}: {
  id: string;
  period: TargetPeriod;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="border-b border-rule px-4 py-3 last:border-b-0">
        <PeriodForm
          action={updateTargetPeriod}
          initial={{ id, ...period }}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0">
      <span className="font-mono text-sm">{formatPeriodRange(period)}</span>
      <span className="flex items-center gap-3">
        <span className="font-mono text-sm font-semibold text-stamp">
          {period.percent}%
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="border border-rule px-2 py-1 font-mono text-[10px] tracking-widest uppercase hover:bg-ink/5"
        >
          Edit
        </button>
        <DeletePeriodButton id={id} period={period} />
      </span>
    </li>
  );
}
```

A successful save revalidates `/settings`, which re-renders the server list; the row remounts in view mode, so no explicit "exit editing" is needed.

- [ ] **Step 2: Use it in the page**

In `src/app/settings/page.tsx`, remove the now-unused imports of `DeletePeriodButton` and `formatPeriodRange` from the *page* (keep `DEFAULT_RTO_PERCENT`), add:

```ts
import { PeriodRow } from "@/components/period-row";
```

and replace the whole `<li>…</li>` block inside the `<ul>` with:

```tsx
              {periods.map((p) => (
                <PeriodRow
                  key={p.id}
                  id={p.id}
                  period={{
                    startMonth: p.startMonth,
                    endMonth: p.endMonth,
                    percent: p.percent,
                  }}
                />
              ))}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean. `lint` will fail if you left an unused import — fix it rather than suppressing.

With `npm run dev`, on `/settings`:

1. Click Edit on a row. The row becomes a form pre-filled with its values.
2. Change the percent to `15`, Save. The row returns to view mode showing `15%`.
3. Click Edit and change the range to overlap another period. Expect the inline overlap error, and the row stays in edit mode.
4. Click Edit then Cancel — no change persists.
5. Edit a row without changing anything and Save — must succeed, proving the row excludes itself from the overlap check.

Step 5 is the regression that `excludeId` exists for.

- [ ] **Step 4: Commit**

```bash
git add src/components/period-row.tsx src/app/settings/page.tsx
git commit -m "feat: edit target periods inline"
```

---

## Task 11: Navigation and unauthenticated copy

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/signin/page.tsx`

- [ ] **Step 1: Add the Settings link**

In `src/app/page.tsx`, replace the header's sign-out block so the link sits beside it:

```tsx
          <div className="flex items-baseline gap-4">
            <Link
              href="/settings"
              className="font-mono text-[11px] tracking-[0.2em] text-fade uppercase underline-offset-4 hover:text-ink hover:underline"
            >
              Settings
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button
                type="submit"
                className="font-mono text-[11px] tracking-[0.2em] text-fade uppercase underline-offset-4 hover:text-ink hover:underline"
              >
                Sign out
              </button>
            </form>
          </div>
```

- [ ] **Step 2: Fix the sign-in copy**

`src/app/signin/page.tsx` line 18 hardcodes 40%. That page is unauthenticated and cannot know the user's rate. Change:

```tsx
          Stamp your office days. Stay on the right side of 40%.
```

to:

```tsx
          Stamp your office days. Stay on the right side of your target.
```

- [ ] **Step 3: Verify no hardcoded 40% remains in the UI**

Run: `grep -rn "40%" src/`
Expected: no output. The only remaining `40` in `src/` should be `DEFAULT_RTO_PERCENT = 40` in `src/lib/rto.ts`, which `grep -rn "40%"` will not match.

Then run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/signin/page.tsx
git commit -m "feat: link settings and drop hardcoded rate from signin"
```

---

## Task 12: Documentation

**Files:**
- Create: `docs/decisions/0002-per-month-targets.md`
- Modify: `CLAUDE.md`, `README.md`, `docs/architecture.md`

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0002-per-month-targets.md`:

```markdown
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
```

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the paragraph that begins `Eligible days = weekdays − holidays − leaves.` with:

```markdown
Eligible days = weekdays − holidays − leaves. Required = `ceil(eligible × targetPercent / 100)`
(rounds up deliberately: 22 eligible at 40% → 9, since 8 would be 36%). The per-week
Mon–Fri breakdown is informational — the requirement is monthly.

**The target rate is per date range, not a constant.** `rto_targets` holds closed periods
(`start_month`, `end_month`, `percent`) per user; `end_month` NULL means ongoing. Months
covered by no period use `DEFAULT_RTO_PERCENT` (40). Month keys are `YYYY-MM` **text**, so
range checks are pure string comparisons — same reasoning as day keys. Overlapping periods
are rejected in `settings-actions.ts`; gaps are intentional and mean "use the default".
`resolvePercent` lives outside `computeMonthStats` so each is separately testable.
```

- [ ] **Step 3: Update `README.md`**

After the "Open http://localhost:3000, sign in with Google, tap days." line, add:

```markdown
The 40% requirement is the default. If your policy changed for a stretch of months
(ours dropped to 20% during a fuel price spike), record that range under **Settings** and
those months are scored at the lower rate — including retroactively.
```

- [ ] **Step 4: Update `docs/architecture.md`**

Replace the `Required office days = ceil(0.4 × eligible)` line with:

```markdown
- Required office days = `ceil(eligible × targetPercent / 100)`, where `targetPercent`
  comes from `rto_targets` for that month, defaulting to 40
```

And in the opening paragraph, change "the company's 40% requirement" to "the company's monthly RTO requirement".

- [ ] **Step 5: Final full verification**

```bash
npx tsc --noEmit && npm run lint && npm test && npm run build
```

Expected: `tsc` silent, lint silent, 31 tests passing, build succeeds listing `/`, `/settings`, `/signin` as `ƒ (Dynamic)`.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0002-per-month-targets.md CLAUDE.md README.md docs/architecture.md
git commit -m "docs: document per-month RTO targets"
```

---

## Done criteria

- [ ] 31 tests pass; no new test dependencies were added
- [ ] `grep -rn "40%" src/` returns nothing
- [ ] `grep -rn "RTO_TARGET" src/` returns nothing (only `DEFAULT_RTO_PERCENT` remains)
- [ ] With no periods configured, the calendar reads exactly as it did before this work
- [ ] A month inside a 20% period shows `20% … (adjusted from 40%)` and a required count of `ceil(eligible × 0.2)`
- [ ] Adding an overlapping period is rejected with a message naming the conflicting period
- [ ] Saving an unchanged period succeeds (self-exclusion works)
- [ ] The delete dialog states the affected month count, or the "onward" wording for an ongoing period
- [ ] `rto_targets` exists on the Neon **dev** branch; production schema untouched

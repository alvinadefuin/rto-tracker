# Fractional Monthly Requirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop rounding a month's RTO requirement up, so 13 eligible days at 40% asks for 5.2 days rather than 6, and add a `training` day status that reduces the eligible base the way leave does.

**Architecture:** The requirement is held as an integer count of **percent-points** (`eligibleDays × targetPercent`), divided by 100 only when a string is rendered. This mirrors what `aggregateMonths` already does for the financial year, and it keeps every comparison in integer arithmetic — `5.2 - 5` is `0.20000000000000018` in binary floating point, so a float requirement makes the "target met" test unreliable at exactly the boundary it exists to detect. The financial year keeps its single `Math.ceil`; only the month stops rounding.

**Tech Stack:** TypeScript, Next.js App Router, Drizzle + Neon Postgres, Vitest (node environment), Tailwind v4 (design tokens in the `@theme` block of `globals.css`, no `tailwind.config.*`).

**Spec:** `docs/superpowers/specs/2026-08-26-fractional-requirement-design.md`

---

## Background you need

Read `CLAUDE.md` before starting. The rules that bite in this plan:

- **Dates are `YYYY-MM-DD` strings end-to-end.** Never parse one through the local timezone. All date maths is UTC component maths.
- **Schema changes travel as committed migrations.** Editing `src/db/schema.ts` without running `npm run db:generate` compiles, deploys green, and then 500s in production. `drizzle/` belongs in the same commit as the schema change.
- **Never `drizzle-kit push`.**
- Vitest runs in a `node` environment, so JSX cannot be asserted. Anything worth testing — including user-visible copy — lives in `src/lib/rto.ts`.

Terminology used throughout: **points** = percent-points, an integer. 13 eligible days at 40% is `520` points, which is `5.2` days.

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/lib/rto.ts` | All pure logic and user-visible copy | `formatDays`, points fields on `MonthStats`, `training` in `DayStatus`/`isEligible`, fractional figure in `fyVerdict` |
| `src/lib/rto.test.ts` | Unit tests | ~a dozen assertions rewritten to exact values; new cases |
| `src/components/stats.tsx` | Renders the month card and FY block | Ring count from points, part-ring, formatted numbers |
| `src/components/calendar.tsx` | Tap cycle and day marks | Fifth cycle step, label, colour lookup, legend |
| `src/app/actions.ts` | Server-side revalidation | `STATUSES` gains `training` |
| `src/db/schema.ts` | Drizzle schema | `day_status` pgEnum gains `training` |
| `src/app/globals.css` | Design tokens | `--color-training` |
| `drizzle/` | Generated migration | New `ALTER TYPE` migration |

Tasks 1–5 are the rounding change. Tasks 6–8 are the training status. Task 9 is the end-to-end acceptance case. The two halves are independent — 6–8 could ship without 1–5 — but the order below keeps each commit green.

---

### Task 1: `formatDays` — points to a readable string

Pure formatter. It takes **points**, never a fractional day, so no binary float reaches the screen.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts` (and add `formatDays` to the existing import block at the top of the file):

```ts
describe("formatDays", () => {
  it("renders a one-decimal requirement", () => {
    expect(formatDays(520)).toBe("5.2"); // 13 eligible at 40%
  });

  it("renders a whole requirement without a decimal point", () => {
    expect(formatDays(800)).toBe("8");
    expect(formatDays(100)).toBe("1");
    expect(formatDays(0)).toBe("0");
  });

  it("keeps a second decimal when the percentage produces one", () => {
    expect(formatDays(429)).toBe("4.29"); // 13 eligible at 33%
    expect(formatDays(405)).toBe("4.05"); // leading zero in the fraction
  });

  it("renders a fraction below one day", () => {
    expect(formatDays(80)).toBe("0.8");
  });

  it("trims only the trailing zero, not a significant one", () => {
    expect(formatDays(440)).toBe("4.4");
    expect(formatDays(404)).toBe("4.04");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts -t "formatDays"`
Expected: FAIL — `formatDays is not a function` (or a TypeScript error that the export does not exist).

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/rto.ts`, directly below the `pad` helper so it sits with the other string builders:

```ts
/**
 * Percent-points as a readable day count: 520 → "5.2", 800 → "8", 429 → "4.29".
 *
 * Takes points rather than a fractional day deliberately. `targetPercent` and
 * `eligibleDays` are both whole, so points/100 is exact to two decimals and the
 * string is built entirely from integer arithmetic — no binary float is ever
 * formatted, and no rounding decision is hidden in here.
 */
export function formatDays(points: number): string {
  const whole = Math.trunc(points / 100);
  const frac = points % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rto.test.ts -t "formatDays"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: format percent-points as a day count"
```

---

### Task 2: Hold the month's requirement in percent-points

The core change. `MonthStats` gains `requiredPoints` and `remainingPoints` as the authoritative integers; `requiredDays` and `remainingNeeded` stay, now fractional.

**Files:**
- Modify: `src/lib/rto.ts` (the `MonthStats` interface and the return of `computeMonthStats`)
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
// The employer's own worked example, from the Aug 2026 RTO email:
// 21 weekdays − 2 holidays − 6 mandated = 13 eligible; 13 × 40% = 5.2.
describe("computeMonthStats in percent-points", () => {
  const mandate: WfhMandate[] = [
    { startDate: "2026-08-17", endDate: "2026-08-24" }, // Mon–Mon, 6 weekdays
  ];
  const holidays: Entries = {
    "2026-08-21": "holiday", // Ninoy Aquino Day (Fri)
    "2026-08-31": "holiday", // National Heroes Day (Mon)
  };

  it("does not round the month up", () => {
    const s = computeMonthStats(2026, 8, holidays, 40, mandate);
    expect(s.eligibleDays).toBe(13);
    expect(s.requiredPoints).toBe(520);
    expect(s.requiredDays).toBe(5.2);
  });

  it("reports the shortfall exactly, in points", () => {
    const entries: Entries = {
      ...holidays,
      "2026-08-03": "office",
      "2026-08-04": "office",
      "2026-08-05": "office",
      "2026-08-06": "office",
      "2026-08-07": "office",
    };
    const s = computeMonthStats(2026, 8, entries, 40, mandate);
    expect(s.officeDays).toBe(5);
    expect(s.remainingPoints).toBe(20); // 520 − 500
    expect(formatDays(s.remainingPoints)).toBe("0.2");
  });

  it("treats the requirement as met only when no points remain", () => {
    const six: Entries = { ...holidays };
    for (const d of ["03", "04", "05", "06", "07", "10"]) {
      six[`2026-08-${d}`] = "office";
    }
    const s = computeMonthStats(2026, 8, six, 40, mandate);
    expect(s.officeDays).toBe(6);
    expect(s.remainingPoints).toBe(0);
  });

  // The reason points exist: 5.2 − 5 is 0.20000000000000018 as a float, so a
  // float comparison at this boundary is not reliable. Points are exact.
  it("never leaves a float residue at the boundary", () => {
    const s = computeMonthStats(2026, 8, holidays, 40, mandate);
    expect(Number.isInteger(s.requiredPoints)).toBe(true);
    expect(Number.isInteger(s.remainingPoints)).toBe(true);
  });

  it("clamps remaining points at zero once the month is over-served", () => {
    const entries: Entries = { ...holidays };
    for (const d of ["03", "04", "05", "06", "07", "10", "11"]) {
      entries[`2026-08-${d}`] = "office";
    }
    const s = computeMonthStats(2026, 8, entries, 40, mandate);
    expect(s.officeDays).toBe(7);
    expect(s.remainingPoints).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts -t "percent-points"`
Expected: FAIL — `s.requiredPoints` is `undefined`, and `requiredDays` is `6` rather than `5.2`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/rto.ts`, replace the `MonthStats` interface with:

```ts
export interface MonthStats {
  eligibleDays: number; // weekdays − mandated − holidays − leaves − training
  officeDays: number;
  /**
   * eligibleDays × targetPercent, in integer percent-points and deliberately
   * un-rounded. Authoritative: every comparison and every rendered string
   * derives from this, not from the fractional sibling below.
   */
  requiredPoints: number;
  requiredDays: number; // requiredPoints / 100 — the readable figure, e.g. 5.2
  /** max(0, requiredPoints − officeDays × 100). Exact; 0 means the month is met. */
  remainingPoints: number;
  remainingNeeded: number; // remainingPoints / 100
  targetPercent: number; // whole percent required this month, e.g. 20
  achievedPercent: number; // whole percent achieved, 0 when eligibleDays === 0
  mandatedDays: number; // mandated weekdays in the month, excluded from eligible
  weeks: WeekStats[]; // Mon–Fri chunks; partial at month edges
}
```

Then replace the final `const requiredDays = ...; return {...}` block of `computeMonthStats` with:

```ts
  // Percent-points, un-rounded: the employer computes 13 × 40% as 5.2 days, not
  // 6. The financial year is where the fraction is finally settled, with a
  // single Math.ceil in computeFyStats — never one per month.
  const requiredPoints = eligibleDays * targetPercent;
  const remainingPoints = Math.max(0, requiredPoints - officeDays * 100);
  return {
    eligibleDays,
    officeDays,
    requiredPoints,
    requiredDays: requiredPoints / 100,
    remainingPoints,
    remainingNeeded: remainingPoints / 100,
    targetPercent,
    achievedPercent:
      eligibleDays === 0 ? 0 : Math.round((officeDays / eligibleDays) * 100),
    mandatedDays,
    weeks,
  };
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run src/lib/rto.test.ts -t "percent-points"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Rewrite the existing assertions that expected a rounded month**

Run the whole file to see the damage:

Run: `npx vitest run src/lib/rto.test.ts`
Expected: FAIL — roughly a dozen failures, all of the form `expected 8.8 to be 9`.

**Rewrite each to its exact value. Do not delete any of them** — a deleted assertion is lost coverage; a rewritten one records the new rule. `FyStats.remainingNeeded` stays an integer and must NOT be touched (lines ~982, ~996, ~1009, ~1035, ~1065, ~1176, ~1187, ~1243, ~1252 are all `fy.remainingNeeded` or `stats({...})` fixtures — leave them).

The exact edits, all in `src/lib/rto.test.ts`:

| Line | Context | Was | Becomes |
| --- | --- | --- | --- |
| 38 | comment above `monthWeekdays` | `ceil(0.4*22)=9` | `22 × 40% = 8.8` |
| 58 | `it(...)` title | `40% target rounded up` | `40% target un-rounded` |
| 62 | 22 eligible @ 40% | `.toBe(9); // ceil(8.8)` | `.toBe(8.8);` |
| 63 | same, 0 office | `.toBe(9)` | `.toBe(8.8)` |
| 73 | 20 eligible @ 40% | `.toBe(8); // ceil(0.4*20)` | `.toBe(8); // 20 × 40% = 8 exactly` |
| 83 | 22 eligible, 2 office | `.toBe(7)` | `.toBe(6.8)` |
| 110 | 0 eligible | `.toBe(0)` | unchanged |
| 270 | 22 @ 40% | `.toBe(9); // ceil(22 * 40 / 100)` | `.toBe(8.8);` |
| 276 | 22 @ 20% | `.toBe(5); // ceil(4.4)` | `.toBe(4.4);` |
| 277 | same | `.toBe(5)` | `.toBe(4.4)` |
| 282–283 | 0% rate | `.toBe(0)` | unchanged |
| 559 | comment | `ceil(7 * 40 / 100) = 3 required` | `7 × 40% = 2.8 required` |
| 566 | 21 @ 40% | `.toBe(9); // ceil(8.4)` | `.toBe(8.4);` |
| 574 | 7 @ 40% | `.toBe(3); // ceil(2.8)` | `.toBe(2.8);` |
| 575 | same | `.toBe(3)` | `.toBe(2.8)` |
| 587 | 7 eligible, 2 office | `.toBe(1)` | `.toBe(0.8)` |
| 597–598 | fully mandated | `.toBe(0)` | unchanged |
| 666 | 18 @ 40% | `.toBe(8); // ceil(7.2)` | `.toBe(7.2);` |
| 1005 | Jul 2027, 22 @ 40% | `.toBe(9); // the month alone still asks for 9` | `.toBe(8.8); // the month alone asks for 8.8` |

Also update the `month()` fixture at ~line 1087, which builds a whole `MonthStats` and will no longer type-check:

```ts
  // Only the remaining figures are read; the rest is filler to make a whole
  // MonthStats. Points and days are kept consistent so the fixture cannot
  // describe a month that computeMonthStats could never produce.
  function month(remainingDays: number): MonthStats {
    return {
      eligibleDays: 22,
      officeDays: 9 - remainingDays,
      requiredPoints: 880,
      requiredDays: 8.8,
      remainingPoints: remainingDays * 100,
      remainingNeeded: remainingDays,
      targetPercent: 40,
      achievedPercent: 0,
      mandatedDays: 0,
      weeks: [],
    };
  }
```

Check the closing lines of that fixture against the file before pasting — the trailing fields after `mandatedDays` must match what is already there.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS. If anything still fails, it is either an `FyStats` assertion you changed by mistake (revert it) or a genuine value you mis-derived (recompute `eligibleDays × percent / 100`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "fix: stop rounding the month's requirement up

The employer computes 13 eligible days at 40% as 5.2 days. computeMonthStats
returned ceil(5.2) = 6, buying a whole office day the requirement never asked
for. The fraction now carries to the financial year, which still rounds once."
```

---

### Task 3: Feed the financial year from points

Behaviour-preserving. `aggregateMonths` and `computeFyStats` currently recompute `eligibleDays * targetPercent` inline; they should read the field instead, so the expression has one definition.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("financial year still rounds exactly once", () => {
  it("owes a whole day for a fractional year total", () => {
    // Three months of 8.8 = 26.4 points-days. Summing monthly figures the old
    // way (ceil each to 9) would owe 27.
    const prior: MonthsAggregate = { officeDays: 0, weightedEligible: 1760 };
    const month = computeMonthStats(2026, 1, {}, 40);
    const fy = computeFyStats("2026-01", baseline(prior), month);
    expect(month.requiredDays).toBe(8.8); // the month does not round
    expect(fy.cumulativeRequired).toBe(27); // ceil(26.4) — the year does
  });

  it("derives the displayed month's contribution from its points", () => {
    const prior: MonthsAggregate = { officeDays: 0, weightedEligible: 0 };
    const month = computeMonthStats(2026, 1, {}, 40);
    const fy = computeFyStats("2026-01", baseline(prior), month);
    expect(fy.cumulativeRequired).toBe(9); // ceil(8.8), one month only
  });
});
```

`baseline` is an existing helper in this file — check its signature before using it and match the call style of the surrounding FY tests.

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `npx vitest run src/lib/rto.test.ts -t "rounds exactly once"`
Expected: PASS already — this is a characterisation test locking in behaviour before the refactor. If it FAILS, stop: Task 2 changed FY behaviour, which it must not have.

- [ ] **Step 3: Refactor to read the field**

In `src/lib/rto.ts`, in `aggregateMonths`, replace:

```ts
    weightedEligible += stats.eligibleDays * percent;
```

with:

```ts
    weightedEligible += stats.requiredPoints;
```

and in `computeFyStats`, replace:

```ts
  const weighted =
    baseline.prior.weightedEligible +
    monthStats.eligibleDays * monthStats.targetPercent;
```

with:

```ts
  const weighted = baseline.prior.weightedEligible + monthStats.requiredPoints;
```

Update the doc comment on `MonthsAggregate.weightedEligible` to say it sums `requiredPoints`.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS, no change in count from Task 2 plus the 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "refactor: sum the year from the month's own points"
```

---

### Task 4: A fractional figure in the FY verdict sentence

`fyVerdict` embeds the **month's** remaining figure inside one branch. Left alone it renders `0.20000000000000018 remaining days are covered`.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Add these two cases **inside the existing `describe("fyVerdict", ...)` block at
`src/lib/rto.test.ts:1069`**, after the last `it(...)` in it. They use that
block's `stats()` helper, which is scoped to it — a new top-level describe would
not see it.

```ts
  it("renders a part-day shortfall without float residue", () => {
    const m: MonthStats = {
      eligibleDays: 13,
      officeDays: 5,
      requiredPoints: 520,
      requiredDays: 5.2,
      remainingPoints: 20,
      remainingNeeded: 0.2,
      targetPercent: 40,
      achievedPercent: 38,
      mandatedDays: 6,
      weeks: [],
    };
    const verdict = fyVerdict(stats(), m); // stats() defaults to balance 3
    expect(verdict).toBe("3 days ahead — this month's 0.2 remaining days are covered.");
    expect(verdict).not.toContain("0.2000");
  });

  it("keeps the singular for exactly one remaining day", () => {
    const m: MonthStats = {
      eligibleDays: 22,
      officeDays: 8,
      requiredPoints: 880,
      requiredDays: 8.8,
      remainingPoints: 100,
      remainingNeeded: 1,
      targetPercent: 40,
      achievedPercent: 36,
      mandatedDays: 0,
      weeks: [],
    };
    expect(fyVerdict(stats(), m)).toBe(
      "3 days ahead — this month's 1 remaining day is covered."
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts -t "part-day shortfall"`
Expected: FAIL — it produces `0.20000000000000018 remaining days are covered`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/rto.ts`, inside `fyVerdict`, replace this block:

```ts
    if (monthStats.remainingNeeded > 0) {
      const remaining = plural(
        monthStats.remainingNeeded,
        "remaining day is",
        "remaining days are"
      );
      return `${ahead} — this month's ${remaining} covered.`;
    }
```

with:

```ts
    // Points, not the fractional day: the month's shortfall can be 0.2, and
    // both the test and the number formatting have to be exact.
    if (monthStats.remainingPoints > 0) {
      const noun =
        monthStats.remainingPoints === 100
          ? "remaining day is"
          : "remaining days are";
      return `${ahead} — this month's ${formatDays(
        monthStats.remainingPoints
      )} ${noun} covered.`;
    }
```

`plural` stays as it is — its other two callers pass `FyStats` integers.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "fix: render the month's part-day shortfall exactly"
```

---

### Task 5: The month card

`stats.tsx` does `Array.from({ length: requiredDays })`. With `requiredDays` now `5.2`, `Array.from` truncates the length to 5 — the row would silently under-report the requirement by a whole ring. Ring count moves to points, and the last ring shows the fraction.

**Files:**
- Modify: `src/components/stats.tsx:37-108`

The part-ring uses the existing `--color-fade` token, so no CSS change is needed here.

No unit test: Vitest runs in a `node` environment and cannot assert JSX. Verify in the browser at Step 4.

- [ ] **Step 1: Swap the destructure and derived counts**

In `src/components/stats.tsx`, in `MonthBlock`, replace the destructure and the two derived counts:

```tsx
  const {
    eligibleDays,
    officeDays,
    requiredPoints,
    remainingPoints,
    targetPercent,
    achievedPercent,
    mandatedDays,
  } = stats;
  // Slots are whole rings: a requirement of 5.2 needs six, the last worth 0.2.
  // Counted from points so the number of rings never depends on binary
  // rounding — Array.from({length: 5.2}) silently yields five.
  const slots = Math.ceil(requiredPoints / 100);
  const partialSlot = requiredPoints % 100; // 0 when the requirement is whole
  const filled = Math.min(officeDays, slots);
  const extra = Math.max(0, officeDays - slots);
```

Add `formatDays` to the existing `@/lib/rto` import.

- [ ] **Step 2: Render the rings**

Replace the `Array.from(...)` block with:

```tsx
          {Array.from({ length: slots }, (_, i) => {
            if (i < filled) {
              return (
                <span
                  key={i}
                  className="inline-block size-4 rounded-full border-2 border-stamp bg-stamp"
                />
              );
            }
            // The final slot can be worth less than a whole day. Show how much
            // rather than drawing a full ring the month never has to fill.
            if (partialSlot > 0 && i === slots - 1) {
              return (
                <span
                  key={i}
                  className="inline-block size-4 rounded-full border-2 border-fade/60"
                  style={{
                    background: `conic-gradient(var(--color-fade) ${partialSlot}%, transparent 0)`,
                  }}
                />
              );
            }
            return (
              <span
                key={i}
                className="inline-block size-4 rounded-full border-2 border-fade/60 bg-transparent"
              />
            );
          })}
```

- [ ] **Step 3: Swap the three rendered numbers**

Replace `{officeDays}/{requiredDays} stamped` with:

```tsx
          {officeDays}/{formatDays(requiredPoints)} stamped ·{" "}
```

Replace the `remainingNeeded > 0` test and its figure with:

```tsx
          {remainingPoints > 0 ? (
            <span className={owedForYear ? "text-stamp" : "text-fade"}>
              {formatDays(remainingPoints)} to go
            </span>
          ) : (
```

Replace `{requiredDays} office days required` with:

```tsx
        {formatDays(requiredPoints)} office days required — {targetPercent}% of{" "}
        {eligibleDays} eligible working days this month
```

Leave the `owedForYear` colour-muting alone.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`, open `http://localhost:3000/?m=2026-08`, and check the month card reads `5.2 office days required` with six rings, the last one part-filled.

If there is no seeded August data, any month works — confirm a month whose eligible count is not a multiple of 5 shows a fraction and a part-ring, and one that is a multiple shows neither.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run build
make lint
git add src/components/stats.tsx
git commit -m "fix: draw the month's fractional requirement

Array.from({length: 5.2}) yields five rings, not six, so the row silently
under-reported the requirement. Ring count now comes from points."
```

---

### Task 6: `training` in the domain type

Pure logic first, so the type exists before the schema and UI need it.

**Files:**
- Modify: `src/lib/rto.ts`
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/rto.test.ts`:

```ts
describe("training days", () => {
  it("takes a day out of the eligible base, like leave", () => {
    const s = computeMonthStats(2026, 1, { "2026-01-05": "training" });
    expect(s.eligibleDays).toBe(21); // 22 weekdays − 1
    expect(s.officeDays).toBe(0);
    expect(s.requiredPoints).toBe(840);
  });

  it("is not eligible", () => {
    expect(isEligible("2026-01-05", { "2026-01-05": "training" }, [])).toBe(false);
  });

  it("counts once when the day is also mandated", () => {
    const mandate: WfhMandate[] = [
      { startDate: "2026-01-05", endDate: "2026-01-05" },
    ];
    const s = computeMonthStats(
      2026,
      1,
      { "2026-01-05": "training" },
      40,
      mandate
    );
    expect(s.eligibleDays).toBe(21);
    expect(s.mandatedDays).toBe(1); // one mandated day, not one of each
  });

  it("reduces the requirement alongside leave and holidays", () => {
    const s = computeMonthStats(2026, 1, {
      "2026-01-01": "holiday",
      "2026-01-02": "leave",
      "2026-01-05": "training",
    });
    expect(s.eligibleDays).toBe(19);
    expect(s.requiredDays).toBe(7.6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rto.test.ts -t "training days"`
Expected: FAIL — TypeScript rejects `"training"` as a `DayStatus`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/rto.ts`, widen the type:

```ts
export type DayStatus = "office" | "leave" | "holiday" | "training";
```

Then replace the body of `isEligible` so the exclusion list has one definition rather than a chain of `!==` that the next status would have to be threaded into. Add this constant directly above `isEligible`:

```ts
/**
 * Statuses that take a weekday out of the eligible base. One list, because the
 * alternative is a chain of `!==` that a fifth status silently falls through.
 */
const NON_ELIGIBLE: readonly DayStatus[] = ["leave", "holiday", "training"];
```

and replace the two lines after the mandate check with:

```ts
  const status = entries[date];
  return status === undefined || !NON_ELIGIBLE.includes(status);
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: exclude training days from the eligible base"
```

---

### Task 7: `training` in the schema and the server action

**Files:**
- Modify: `src/db/schema.ts:88-92`
- Modify: `src/app/actions.ts:11`
- Create: `drizzle/NNNN_<generated-name>.sql` (Drizzle names it)

- [ ] **Step 1: Append the enum value**

In `src/db/schema.ts`, add `"training"` **as the last element**:

```ts
export const dayStatusEnum = pgEnum("day_status", [
  "office",
  "leave",
  "holiday",
  "training",
]);
```

Last position matters. Appending lets Drizzle emit a plain `ALTER TYPE ... ADD VALUE`; inserting in the middle can make it emit a `BEFORE`/`AFTER` clause or, worse, a type recreate.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file at `drizzle/NNNN_<name>.sql`.

- [ ] **Step 3: Read the generated SQL before applying it**

Run: `cat drizzle/*_*.sql | tail -20`

Expected content — a single additive statement, near enough to:

```sql
ALTER TYPE "public"."day_status" ADD VALUE 'training';
```

**Stop and ask if you see anything else.** A `DROP TYPE`, a `CREATE TYPE ... day_status_new`, or any statement touching `day_entries` means Drizzle decided to recreate rather than extend, which would destroy recorded days. CLAUDE.md is explicit that `generate` cannot always tell an addition from a replacement.

Postgres normally refuses `ALTER TYPE ... ADD VALUE` inside a transaction block. That is fine here: `neon-http` issues each statement as its own round-trip with no enclosing transaction.

- [ ] **Step 4: Apply to the dev branch**

Run: `npm run db:migrate`
Expected: exits 0.

Then confirm the journal and the database agree:

Run: `npm run db:check`
Expected: exits 0.

- [ ] **Step 5: Accept the status server-side**

In `src/app/actions.ts`, line 11:

```ts
const STATUSES: DayStatus[] = ["office", "leave", "holiday", "training"];
```

- [ ] **Step 6: Commit the schema and its migration together**

The migration file **is** the change. A schema edit without it compiles, deploys green, and 500s on the first query.

```bash
git add src/db/schema.ts src/app/actions.ts drizzle/
git commit -m "feat: add a training day status"
```

---

### Task 8: `training` in the calendar

**Files:**
- Modify: `src/app/globals.css` (the `@theme` block, around line 10)
- Modify: `src/components/calendar.tsx:19-26`, `:64-70`, `:274`

- [ ] **Step 1: Add the colour token**

In `src/app/globals.css`, inside the `@theme` block alongside `--color-leave` and `--color-holiday`:

```css
  --color-training: #a4762b;
```

Ochre — distinct from the stamp red, the leave blue-grey, and the holiday green. There is no `tailwind.config.*`; tokens live here and `text-training` follows from the variable name.

- [ ] **Step 2: Extend the cycle and the label**

In `src/components/calendar.tsx`:

```tsx
const CYCLE: (DayStatus | null)[] = [
  null,
  "office",
  "leave",
  "holiday",
  "training",
];

const STATUS_LABEL: Record<DayStatus | "wfh", string> = {
  wfh: "Work from home",
  office: "Office",
  leave: "Leave",
  holiday: "Holiday",
  training: "Training",
};
```

- [ ] **Step 3: Replace the two-way colour ternary**

`DayMark` currently ends with `status === "leave" ? "text-leave" : "text-holiday"`, which silently paints training in the holiday colour. Add this above `DayMark`:

```tsx
// Every non-office status needs a colour; a ternary here would quietly paint a
// new status in the last branch's colour.
const STATUS_CLASS: Record<Exclude<DayStatus, "office">, string> = {
  leave: "text-leave",
  holiday: "text-holiday",
  training: "text-training",
};
```

and replace the ternary inside the returned `className` with `STATUS_CLASS[status]`. TypeScript narrows `status` to `Exclude<DayStatus, "office">` after the early return above it, so the lookup type-checks and a future status will fail the build here rather than render wrong.

- [ ] **Step 4: Update the legend**

Line ~274:

```tsx
        Tap a weekday to cycle: work from home → office → leave → holiday →
        training.
```

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, open `http://localhost:3000`, and tap a weekday five times. Expected: `office → leave → holiday → training → back to blank`, training rendered in ochre, and the eligible count in the month card dropping by one when a day is marked training.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run build
make lint
git add src/app/globals.css src/components/calendar.tsx
git commit -m "feat: cycle a weekday to training"
```

---

### Task 9: The email's scenario, end to end

One acceptance test proving the whole chain produces the number the employer stated.

**Files:**
- Test: `src/lib/rto.test.ts`

- [ ] **Step 1: Write the test**

```ts
// The RTO email of Aug 2026, reproduced in full:
//   21 working days → 19 after holidays → 13 after a 6-day exclusion
//   13 × 40% = 5.2 days required, further reduced by leave and training.
describe("the Aug 2026 RTO email", () => {
  const mandate: WfhMandate[] = [
    { startDate: "2026-08-17", endDate: "2026-08-24" },
  ];

  it("reproduces the stated 5.2", () => {
    const s = computeMonthStats(
      2026,
      8,
      { "2026-08-21": "holiday", "2026-08-31": "holiday" },
      40,
      mandate
    );
    expect(s.eligibleDays).toBe(13);
    expect(s.mandatedDays).toBe(6);
    expect(formatDays(s.requiredPoints)).toBe("5.2");
  });

  it("reduces the 5.2 further for leave and training", () => {
    const s = computeMonthStats(
      2026,
      8,
      {
        "2026-08-21": "holiday",
        "2026-08-31": "holiday",
        "2026-08-03": "leave",
        "2026-08-04": "training",
      },
      40,
      mandate
    );
    expect(s.eligibleDays).toBe(11);
    expect(formatDays(s.requiredPoints)).toBe("4.4");
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/rto.test.ts -t "Aug 2026 RTO email"`
Expected: PASS, 2 tests. Everything it needs is already built; this is the acceptance check, not new behaviour.

If `mandatedDays` is not 6, recount: 17–24 Aug 2026 inclusive spans Mon 17, Tue 18, Wed 19, Thu 20, Fri 21, Mon 24 — six weekdays, and Fri 21 is also a holiday, which is why it is one mandated day and not one of each.

- [ ] **Step 3: Full verification**

```bash
make test
make lint
npm run build
```

Expected: all three exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rto.test.ts
git commit -m "test: reproduce the Aug 2026 RTO email end to end"
```

---

## Done when

- `make test`, `make lint`, and `npm run build` all pass.
- A month with 13 eligible days at 40% shows `5.2 office days required`, six rings with the last part-filled, and `0.2 to go` at five stamped.
- Tapping a weekday cycles through training, and a training day drops the eligible count by one.
- `drizzle/` contains the new migration and it is committed alongside `src/db/schema.ts`.
- No `FyStats` assertion changed: the financial year still rounds up exactly once.

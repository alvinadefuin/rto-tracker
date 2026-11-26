# Covered Rings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark the month's rings that a surplus banked earlier in the financial year already settles, as a distinct dashed green "covered" ring.

**Architecture:** All arithmetic and copy go in `src/lib/rto.ts`, where Vitest can assert them: a `priorBalancePoints` helper derives the year's balance before the displayed month from the `FyStats` and `MonthStats` the component already has; `monthMeter` gains an optional second argument and a `covered` field; `coveredNote` builds the caption clause. `src/components/stats.tsx` only draws the third ring state and appends the clause.

**Tech Stack:** TypeScript, Vitest (node environment), React 19, Tailwind v4.

Spec: `docs/superpowers/specs/2026-11-26-covered-rings-design.md`

No schema change, no migration.

---

### Task 1: `priorBalancePoints`, `monthMeter(…, priorBalancePoints)`, `coveredNote`

**Files:**
- Modify: `src/lib/rto.ts` — `MonthMeter` and `monthMeter` (~lines 444–478); add `priorBalancePoints` directly after `computeFyStats` (~line 637); add `coveredNote` directly after `monthMeter`.
- Test: `src/lib/rto.test.ts` — import list (lines 2–41); the existing `describe("monthMeter")` (~lines 1773–1929); new describe blocks after it.

- [ ] **Step 1: Add `covered: 0` to every existing `monthMeter` expectation**

The eight `expect(monthMeter(s)).toEqual({ … })` objects in `describe("monthMeter")` gain a fifth field. `toEqual` fails on an extra property, so without this they break the moment `covered` exists — and none of them passes a prior balance, so `0` is correct for all of them. In each, after the `extra:` line add:

```ts
      covered: 0,
```

The eight `extra:` lines are at roughly 1822, 1835, 1850, 1863, 1875, 1883, 1905 and 1927 (`grep -n "extra: " src/lib/rto.test.ts`).

- [ ] **Step 2: Import the new functions in the test file**

In the import list in `src/lib/rto.test.ts`, after `monthMeter,` add:

```ts
  priorBalancePoints,
  coveredNote,
```

- [ ] **Step 3: Write the failing tests**

Append after the closing `});` of `describe("monthMeter")` (before `describe("the financial year sums fractional months without rounding"`):

```ts
describe("monthMeter covered rings", () => {
  // Only requiredPoints and officeDays are read. remainingPoints is kept
  // consistent with them so the fixture cannot describe a month that
  // computeMonthStats could never produce; the rest is filler.
  function owing(requiredPoints: number, officeDays = 0): MonthStats {
    return {
      eligibleDays: 22,
      officeDays,
      requiredPoints,
      remainingPoints: Math.max(0, requiredPoints - officeDays * 100),
      targetPercent: 40,
      achievedPercent: 0,
      mandatedDays: 0,
      weeks: [],
    };
  }

  // 8.8 days owed is nine rings, the last worth 0.8. Each row is the spec's
  // table: covered = slots − the whole stamps still needed for the year to
  // stay level, never floor(surplus) — that would leave a 0.8 surplus unable
  // to cover a 0.8 ring.
  it.each([
    [80, 1], // 800 still needed → 8 stamps
    [140, 1], // 740 → 8
    [200, 2], // 680 → 7
    [20, 0], // 860 → 9
    [1000, 9], // the surplus outsizes the month
    [0, 0], // level coming in
  ])("a prior balance of %i points covers %i of 8.8's nine rings", (prior, covered) => {
    expect(monthMeter(owing(880), prior)).toEqual({
      slots: 9,
      partialSlot: 80,
      filled: 0,
      extra: 0,
      covered,
    });
  });

  it("never reports a negative count for a prior deficit", () => {
    // 3 days behind: 1180 still needed is twelve stamps against nine rings.
    // The deficit adds no rings and covers none.
    expect(monthMeter(owing(880), -300).covered).toBe(0);
  });

  it("covers nothing when the month asks for nothing", () => {
    expect(monthMeter(owing(0), 500)).toEqual({
      slots: 0,
      partialSlot: 0,
      filled: 0,
      extra: 0,
      covered: 0,
    });
  });

  it("does not move as this month is stamped", () => {
    // Covered is fixed by the prior balance; stamps fill from the left and
    // the component lets a stamp beat a cover, so the count itself is stable.
    for (let office = 0; office <= 9; office++) {
      expect(monthMeter(owing(880, office), 140).covered).toBe(1);
    }
  });

  // The property the formula exists for: with a non-negative prior balance,
  // the rings complete exactly when the year stops owing — which is when
  // MonthBlock's owedForYear greys this month's "to go".
  it("completes the row exactly when the year is level or ahead", () => {
    for (const required of [0, 80, 520, 800, 880, 1100]) {
      for (const prior of [0, 20, 80, 100, 140, 200, 520, 1000]) {
        for (let office = 0; office <= 12; office++) {
          const month = owing(required, office);
          const fy = computeFyStats(
            "2026-10",
            {
              windowStartMonth: "2026-08",
              prior: { officeDays: 20, weightedEligible: 2000 - prior },
            },
            month
          );
          const { filled, covered, slots } = monthMeter(month, prior);
          expect(filled + covered >= slots).toBe(
            fy.remainingNeededPoints === 0
          );
        }
      }
    }
  });
});

describe("priorBalancePoints", () => {
  it("recovers the balance of the months before the displayed one", () => {
    // Oct 2026 with 4 stamps against 22 × 40% = 880 points.
    const october = computeMonthStats(
      2026,
      10,
      {
        "2026-10-01": "office",
        "2026-10-02": "office",
        "2026-10-05": "office",
        "2026-10-06": "office",
      },
      40
    );
    const prior: MonthsAggregate = { officeDays: 23, weightedEligible: 1720 };
    const fy = computeFyStats(
      "2026-10",
      { windowStartMonth: "2026-08", prior },
      october
    );
    // 23 × 100 − 1720 = 580: Aug–Sep banked 5.8 days.
    expect(priorBalancePoints(fy, october)).toBe(580);
  });

  it("is negative when the earlier months fell short", () => {
    const october = computeMonthStats(2026, 10, {}, 40);
    const fy = computeFyStats(
      "2026-10",
      {
        windowStartMonth: "2026-08",
        prior: { officeDays: 15, weightedEligible: 1720 },
      },
      october
    );
    expect(priorBalancePoints(fy, october)).toBe(-220);
  });
});

describe("coveredNote", () => {
  const meter = (covered: number) => ({
    slots: 9,
    partialSlot: 80,
    filled: 0,
    extra: 0,
    covered,
  });

  it("says nothing when no ring is covered", () => {
    expect(coveredNote(meter(0))).toBeNull();
  });

  it("counts the covered rings", () => {
    expect(coveredNote(meter(1))).toBe("1 covered by earlier months' surplus");
    expect(coveredNote(meter(2))).toBe("2 covered by earlier months' surplus");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: FAIL — the eight existing `monthMeter` cases fail on the missing `covered` property, and the new blocks fail because `priorBalancePoints` and `coveredNote` are not exported (`is not a function`).

- [ ] **Step 5: Extend `MonthMeter` and `monthMeter`**

In `src/lib/rto.ts`, replace the `MonthMeter` interface with:

```ts
export interface MonthMeter {
  slots: number; // whole rings; the requirement rounded up
  partialSlot: number; // 0..99 — the last ring's worth, 0 when the requirement is whole
  filled: number; // rings stamped
  extra: number; // whole rings of surplus past the row
  covered: number; // rings at the row's right end the year's prior surplus settles
}
```

Append to `monthMeter`'s doc comment, before its closing `*/`:

```ts
 *
 * `covered` is how many rings, counted from the right, a surplus banked in the
 * year's earlier months already settles: the row minus the whole stamps this
 * month still needs for the year to stay level. It is not
 * floor(priorBalancePoints / 100) — that would leave a 0.8 surplus unable to
 * cover the 0.8 ring it exactly pays for. Computed this way, with a prior
 * balance ≥ 0, `filled + covered ≥ slots` holds exactly when the year owes
 * nothing, which is when MonthBlock's owedForYear greys "to go". The outer
 * max(0, …) is load-bearing: a prior deficit makes "still needed" exceed the
 * row. Covered rings are not stamps and never touch `filled` or `extra`.
```

Replace the function itself with:

```ts
export function monthMeter(
  stats: MonthStats,
  priorBalancePoints = 0
): MonthMeter {
  const { requiredPoints, officeDays } = stats;
  const slots = Math.ceil(requiredPoints / 100);
  const stillNeeded = Math.ceil(
    Math.max(0, requiredPoints - priorBalancePoints) / 100
  );
  return {
    slots,
    partialSlot: requiredPoints % 100,
    filled: Math.min(officeDays, slots),
    extra: Math.max(0, officeDays - slots),
    covered: Math.max(0, slots - stillNeeded),
  };
}

/**
 * The caption clause naming the covered rings, or null when there are none.
 *
 * The ring row is aria-hidden on the premise that it carries nothing the text
 * does not; covered rings would break that without this. It counts rings, not
 * points, and "1 covered" reads the same as "2 covered", so only the number
 * varies. Copy lives here rather than in the component for the reason
 * fyVerdict's does: Vitest runs without a DOM.
 */
export function coveredNote(meter: MonthMeter): string | null {
  if (meter.covered === 0) return null;
  return `${meter.covered} covered by earlier months' surplus`;
}
```

- [ ] **Step 6: Add `priorBalancePoints`**

Directly after the closing `}` of `computeFyStats`, add:

```ts
/**
 * The year's balance before the displayed month, in percent-points: the
 * displayed month's own contribution taken back out of `balancePoints`. It
 * equals `prior.officeDays × 100 − prior.weightedEligible` from the baseline,
 * derived from what `Stats` already receives so no prop is added for it.
 * Stamping the displayed month moves both terms equally, so it is fixed for the
 * month — the covered rings it drives never shift under a tap.
 */
export function priorBalancePoints(fy: FyStats, month: MonthStats): number {
  return fy.balancePoints - (month.officeDays * 100 - month.requiredPoints);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS, all cases.

Then the whole suite and types: `make test && npx tsc --noEmit`
Expected: PASS, no type errors. (`stats.tsx` still compiles: the new argument is optional and the new field is simply unread.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: count the rings a prior surplus covers"
```

---

### Task 2: Draw covered rings in `MonthBlock`

**Files:**
- Modify: `src/components/stats.tsx` — imports (lines 1–11), the header comment (lines 13–15), `MonthBlock`'s meter call (~line 53), the ring loop (~lines 79–104), the caption (~lines 124–135).

No unit test: Vitest runs in `node` and cannot render this component. The ring rules here (a stamp beats a cover; covered rings at the right end; no partial gradient on a covered ring) are verified in the browser, like the existing partial-ring rule.

- [ ] **Step 1: Import the new functions**

```ts
import {
  DEFAULT_RTO_PERCENT,
  coveredNote,
  formatDays,
  formatMonth,
  fyCarryNote,
  fyFillPercent,
  fyVerdict,
  monthMeter,
  priorBalancePoints,
  type FyStats,
  type MonthStats,
} from "@/lib/rto";
```

- [ ] **Step 2: Update the header comment**

Replace the three-line comment above `export function Stats` with:

```ts
// Stamp-card meter — one ring per required office day, rounded up, filled as
// stamped; a fractional requirement leaves its last ring drawn short until a
// stamp fills it, and rings a surplus from earlier in the year already settles
// are drawn dashed — with the financial year's running position underneath.
```

- [ ] **Step 3: Pass the prior balance and take the new values**

Replace:

```ts
  const { slots, partialSlot, filled, extra } = monthMeter(stats);
```

with:

```ts
  const meter = monthMeter(
    stats,
    fyStats ? priorBalancePoints(fyStats, stats) : 0
  );
  const { slots, partialSlot, filled, extra, covered } = meter;
  const covers = coveredNote(meter);
```

- [ ] **Step 4: Draw the third ring state**

Replace the body of the `Array.from({ length: slots }, (_, i) => { … })` callback with:

```tsx
            const stamped = i < filled;
            // Settled by a surplus from earlier in the year. Dashed holiday
            // green — the colour "target met" uses — and hollow, so it never
            // reads as a stamp. A stamp beats a cover: stamping past the gap
            // draws a stamp here.
            const isCovered = !stamped && i >= slots - covered;
            // The final slot can be worth less than a whole day. Show how much
            // rather than drawing a full ring the month never has to fill.
            // Drawn in fade, not stamp: this is the size of the obligation, not
            // progress against it — and it disappears once a stamp lands on it,
            // or once a surplus covers it.
            const partial =
              !stamped && !isCovered && partialSlot > 0 && i === slots - 1;
            return (
              <span
                key={i}
                className={`inline-block size-4 rounded-full border-2 ${
                  stamped
                    ? "border-stamp bg-stamp"
                    : isCovered
                      ? "border-dashed border-holiday bg-transparent"
                      : "border-fade/60 bg-transparent"
                }`}
                style={
                  partial
                    ? {
                        background: `conic-gradient(var(--color-fade) ${partialSlot}%, transparent 0)`,
                      }
                    : undefined
                }
              />
            );
```

- [ ] **Step 5: Append the clause to the caption**

In the caption paragraph, replace:

```tsx
        {mandatedDays > 0 && <> · {mandatedDays} days mandated WFH</>}.
```

with:

```tsx
        {mandatedDays > 0 && <> · {mandatedDays} days mandated WFH</>}
        {covers && <> · {covers}</>}.
```

- [ ] **Step 6: Type-check, lint, test, build**

Run: `npx tsc --noEmit && make lint && make test && npm run build`
Expected: all pass.

- [ ] **Step 7: Check it in the browser**

Run `npm run dev` and open http://localhost:3000. If the page shows stale behaviour, unregister the service worker for localhost:3000 in DevTools → Application first; it serves cached chunks.

Check, on the dev branch's data:
1. **August** (the FY's first month): no dashed rings, caption unchanged.
2. A month after a month with surplus: dashed green rings at the right end of the row. The count matches the caption's "N covered by earlier months' surplus". The partial ring, if covered, shows no gradient.
3. Stamp days in that month until stamps reach the dashed rings. The remaining dashed rings stay dashed, the "to go" text turns grey exactly when the last plain ring is stamped, and stamping further turns dashed rings solid.
4. A month after a deficit: no dashed rings.

If the data lacks a surplus month, stamp extra days in an earlier month of the FY to create one, then undo them afterwards.

- [ ] **Step 8: Commit**

```bash
git add src/components/stats.tsx
git commit -m "feat: draw rings a prior surplus covers as dashed"
```

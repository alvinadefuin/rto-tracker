# Un-rounded Financial-Year Total — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the single `Math.ceil` from the financial-year path so the year reports its requirement, balance and shortfall in exact percent-points, and add one state-aware sentence explaining where a month's unpaid fraction went.

**Architecture:** `FyStats` swaps its three day-valued fields (`cumulativeRequired`, `balance`, `remainingNeeded`) for points-valued ones (`cumulativeRequiredPoints`, `balancePoints`, `remainingNeededPoints`), matching the representation `MonthStats` has used since ADR 0006. The renames are deliberate: a call site left unconverted would keep type-checking against a number that is now 100× larger, so the compiler is what finds all four of them. Copy that counts days moves from a whole-number `plural` helper to a points-aware `dayCount`, and a new exported `fyCarryNote` returns the explanatory sentence or `null`.

**Tech Stack:** TypeScript, Next.js App Router (React 19), Vitest in a `node` environment, Tailwind v4. No database, schema or migration work — every number here is derived on render.

**Spec:** `docs/superpowers/specs/2026-09-01-fractional-fy-total-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/lib/rto.ts` | All pure arithmetic and all rendered copy. The only file Vitest can assert, which is why the sentences live here and not in JSX. | Modify: `MonthStats.remainingPoints` doc, `MonthsAggregate.weightedEligible` doc, `FyStats`, `computeFyStats`, `plural` → `dayCount`, `fyVerdict`, new `fyCarryNote` |
| `src/lib/rto.test.ts` | Unit tests. The only test file in the project. | Modify: `computeFyStats` and `fyVerdict` blocks; add `fyCarryNote` block |
| `src/components/stats.tsx` | Draws the month stamp card and the FY bar. No arithmetic beyond the bar's fill ratio. | Modify: `MonthBlock:72`, `FyBlock:146-181` |
| `docs/decisions/0007-fractional-financial-year-total.md` | Records the reversal. | Create |
| `docs/decisions/0005-financial-year-carryover.md` | Introduced the `ceil`. | Modify: amend in place |
| `docs/decisions/0006-fractional-monthly-requirement.md` | Reaffirmed the `ceil`. | Modify: amend in place |
| `docs/architecture.md` | Rules summary. | Modify: two bullets |
| `CLAUDE.md` | Agent-facing invariants. | Modify: FY paragraph |

Nothing else is touched. `page.tsx`, `calendar.tsx`, `actions.ts`, `src/db/schema.ts` and `drizzle/` are all unchanged — `FyStats` is built and consumed entirely inside `computeFyStats` → `Stats`, and `FyBaseline` (the thing `page.tsx` serialises) keeps its shape.

---

## Task 1: `FyStats` holds percent-points

The whole rename lands in one commit. Splitting it would leave the suite red between commits: `fyVerdict` reads `FyStats` fields directly, and `stats.tsx` renders them, so the type and its three consumers move together or not at all.

**Files:**
- Modify: `src/lib/rto.ts` — `MonthStats.remainingPoints` doc (~line 27), `MonthsAggregate` (~line 490), `FyStats` (~line 545), `computeFyStats` (~line 570), `plural` (~line 610), `fyVerdict` (~line 615-679)
- Modify: `src/components/stats.tsx:72`, `:146`, `:151-154`, `:176`, `:178`
- Test: `src/lib/rto.test.ts` — `describe("computeFyStats")` from `:939`, `describe("fyVerdict")` from `:1075`

- [ ] **Step 1: Rewrite the `computeFyStats` assertions to points**

In `src/lib/rto.test.ts`, inside `describe("computeFyStats", ...)`. Replace these five tests wholesale — the fixtures above them (`PRIOR_AUG_SEP`, `OCT_OFFICE`, `baseline`) and the `derives the year and its bounds`, `flags the final month only in July` and `flags a partial window` tests are unchanged.

```ts
  it("keeps the FY total un-rounded, never summing per-month round-ups", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats("2026-10", baseline(PRIOR_AUG_SEP), october);
    // 1720 + 22*40 = 2600 percent-points -> exactly 26 days, held as points.
    expect(fy.cumulativeRequiredPoints).toBe(2600);
    // Summing monthly ceils would owe 27: ceil(8.4)+ceil(8.8)+ceil(8.8).
    const monthlySum =
      Math.ceil((21 * 40) / 100) +
      Math.ceil((22 * 40) / 100) +
      Math.ceil((22 * 40) / 100);
    expect(monthlySum).toBe(27);
    expect(fy.cumulativeRequiredPoints).toBeLessThan(monthlySum * 100);
  });

  it("adds the displayed month's office days to the prior window", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats("2026-10", baseline(PRIOR_AUG_SEP), october);
    expect(fy.cumulativeOffice).toBe(29);
    expect(fy.balancePoints).toBe(300);
    expect(fy.remainingNeededPoints).toBe(0);
    expect(fy.fy).toBe(2027);
  });

  it("carries a shortfall forward as days still owed", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats(
      "2026-10",
      baseline({ officeDays: 5, weightedEligible: 1720 }),
      october
    );
    expect(fy.cumulativeOffice).toBe(11);
    expect(fy.cumulativeRequiredPoints).toBe(2600);
    expect(fy.balancePoints).toBe(-1500);
    expect(fy.remainingNeededPoints).toBe(1500);
  });

  it("banks the fraction a whole month worked from home leaves over", () => {
    // 11 required against 20 stamped through June: 9 days banked.
    const prior: MonthsAggregate = { officeDays: 20, weightedEligible: 1100 };
    // Jul 2027 has 22 weekdays and nothing stamped.
    const july = computeMonthStats(2027, 7, {}, 40);
    const fy = computeFyStats("2027-07", baseline(prior), july);
    expect(formatDays(july.requiredPoints)).toBe("8.8"); // the month alone asks for 8.8
    expect(fy.cumulativeRequiredPoints).toBe(1980); // 1100 + 880, never ceil'd up to 20
    expect(fy.cumulativeOffice).toBe(20);
    // The old ceil called this exactly level. The year really owes 19.8, so the
    // twentieth stamp is a 0.2 surplus, and the FY is where it is credited.
    expect(fy.balancePoints).toBe(20);
    expect(fy.remainingNeededPoints).toBe(0);
    expect(fy.isFinalMonth).toBe(true);
  });

  it("reports a shortfall standing in the final month", () => {
    // 19.8 required through July against 14 stamped: the year ends 5.8 short,
    // where the ceil reported a round 6.
    const july = computeMonthStats(2027, 7, {}, 40);
    const fy = computeFyStats(
      "2027-07",
      baseline({ officeDays: 14, weightedEligible: 1100 }),
      july
    );
    expect(fy.isFinalMonth).toBe(true);
    expect(fy.cumulativeRequiredPoints).toBe(1980);
    expect(fy.balancePoints).toBe(-580);
    expect(fy.remainingNeededPoints).toBe(580);
  });

  it("handles an all-mandated window without dividing by zero", () => {
    const mandates: WfhMandate[] = [
      { startDate: "2026-10-01", endDate: "2026-10-31" },
    ];
    const october = computeMonthStats(2026, 10, {}, 40, mandates);
    const fy = computeFyStats(
      "2026-10",
      baseline({ officeDays: 0, weightedEligible: 0 }),
      october
    );
    expect(fy.cumulativeRequiredPoints).toBe(0);
    expect(fy.cumulativeOffice).toBe(0);
    expect(fy.balancePoints).toBe(0);
    expect(fy.remainingNeededPoints).toBe(0);
  });
```

- [ ] **Step 2: Add the two tests that justify the change**

Append these inside the same `describe("computeFyStats", ...)`, before its closing `});`.

```ts
  it("leaves the met/not-met boundary exactly where the old ceil put it", () => {
    // 104.4 owed for the year. ceil(104.4) was 105 and 105 whole days is still
    // what clears it — an integer day count cannot land on 104.4. Only the
    // reported magnitude got finer. This is the property the change rests on.
    const july = computeMonthStats(2027, 7, {}, 0); // 0% — contributes nothing
    const at104 = computeFyStats(
      "2027-07",
      baseline({ officeDays: 104, weightedEligible: 10440 }),
      july
    );
    const at105 = computeFyStats(
      "2027-07",
      baseline({ officeDays: 105, weightedEligible: 10440 }),
      july
    );
    expect(at104.remainingNeededPoints).toBe(40); // 0.4 short
    expect(at105.remainingNeededPoints).toBe(0);
    expect(at105.balancePoints).toBe(60); // 0.6 banked, where ceil reported 0
  });

  it("agrees with the old ceil on whether the year is owed, at every count", () => {
    // The property the whole change rests on: for an integer day count,
    // `office × 100 ≥ P` is exactly `office ≥ ceil(P / 100)`. Swept either side
    // of a fractional requirement so it is asserted rather than argued — this
    // is what keeps owedForYear's colour muting in stats.tsx unchanged.
    const july = computeMonthStats(2027, 7, {}, 0); // 0% — contributes nothing
    for (let officeDays = 100; officeDays <= 110; officeDays++) {
      const fy = computeFyStats(
        "2027-07",
        baseline({ officeDays, weightedEligible: 10440 }),
        july
      );
      const oldCeilSaidOwed = officeDays < Math.ceil(10440 / 100);
      expect(fy.remainingNeededPoints > 0).toBe(oldCeilSaidOwed);
    }
  });

  it("reports a part-day shortfall rather than rounding it to a whole day", () => {
    // August: 13 eligible at 40% is 5.2 owed, 5 stamped. Viewed from September,
    // the year says 0.2 — the number the month card showed, not a whole day.
    const september = computeMonthStats(2026, 9, {}, 0); // 0% — contributes nothing
    const fy = computeFyStats(
      "2026-09",
      baseline({ officeDays: 5, weightedEligible: 520 }),
      september
    );
    expect(fy.cumulativeRequiredPoints).toBe(520);
    expect(fy.balancePoints).toBe(-20);
    expect(formatDays(fy.remainingNeededPoints)).toBe("0.2");
  });
```

- [ ] **Step 3: Convert the `fyVerdict` fixture and its overrides**

In `describe("fyVerdict", ...)` at `:1075`, replace the `stats` helper:

```ts
  function stats(overrides: Partial<FyStats> = {}): FyStats {
    return {
      fy: 2027,
      fyStartMonth: "2026-08",
      fyEndMonth: "2027-07",
      windowStartMonth: "2026-08",
      isPartialWindow: false,
      isFinalMonth: false,
      cumulativeOffice: 29,
      cumulativeRequiredPoints: 2600,
      balancePoints: 300,
      remainingNeededPoints: 0,
      ...overrides,
    };
  }
```

Then convert every override in that block, multiplying each by 100. Expected strings are **unchanged** — every value here is a whole number of days:

| existing override | becomes |
| --- | --- |
| `cumulativeRequired: 0` | `cumulativeRequiredPoints: 0` |
| `cumulativeRequired: 103` | `cumulativeRequiredPoints: 10300` |
| `balance: 3` | `balancePoints: 300` |
| `balance: 1` | `balancePoints: 100` |
| `balance: 0` | `balancePoints: 0` |
| `balance: -1` | `balancePoints: -100` |
| `balance: -2` | `balancePoints: -200` |
| `balance: -103` | `balancePoints: -10300` |
| `remainingNeeded: 0` | `remainingNeededPoints: 0` |
| `remainingNeeded: 1` | `remainingNeededPoints: 100` |
| `remainingNeeded: 2` | `remainingNeededPoints: 200` |
| `remainingNeeded: 103` | `remainingNeededPoints: 10300` |

Leave `cumulativeOffice` alone everywhere — it is still a whole day count.

- [ ] **Step 4: Add the three fractional verdict tests**

Append inside the same `describe("fyVerdict", ...)`, before its closing `});`.

```ts
  it("reports a part-day shortfall exactly", () => {
    expect(
      fyVerdict(
        stats({
          balancePoints: -20,
          cumulativeOffice: 5,
          cumulativeRequiredPoints: 520,
          remainingNeededPoints: 20,
        }),
        month(0)
      )
    ).toBe("0.2 more office days needed to be level.");
  });

  it("reports a part-day surplus rather than calling the year level", () => {
    // 19.8 owed, 20 stamped. The ceil said "Level — no days banked."
    expect(
      fyVerdict(
        stats({
          balancePoints: 20,
          cumulativeOffice: 20,
          cumulativeRequiredPoints: 1980,
        }),
        month(0)
      )
    ).toBe("0.2 days ahead — banked toward later months.");
  });

  it("counts a multi-day fraction in the plural", () => {
    // dayCount is private, so its singular rule is asserted through the copy.
    // 250 points is 2.5 days — plural, like 20, where only 100 is singular.
    expect(
      fyVerdict(
        stats({
          balancePoints: 250,
          cumulativeOffice: 12,
          cumulativeRequiredPoints: 950,
        }),
        month(0)
      )
    ).toBe("2.5 days ahead — banked toward later months.");
  });

  it("reports a part-day shortfall against the whole year in July", () => {
    expect(
      fyVerdict(
        stats({
          balancePoints: -40,
          cumulativeOffice: 104,
          cumulativeRequiredPoints: 10440,
          remainingNeededPoints: 40,
          isFinalMonth: true,
        }),
        month(0)
      )
    ).toBe("0.4 office days short of FY2027's full year.");
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: FAIL. The `computeFyStats` cases report `undefined` for every new field name; the `fyVerdict` cases report `NaN` or `undefined` where `fy.balance` no longer exists.

- [ ] **Step 6: Update the two doc comments the change invalidates**

In `src/lib/rto.ts`, the `remainingPoints` field of `MonthStats`. Replace its final sentence:

```ts
  /**
   * max(0, requiredPoints − officeDays × 100). Exact, so `=== 0` *is* the
   * target-met test. Neither the month nor the year rounds: the FY sums these
   * points as they are, and `formatDays` at the display edge is the only place
   * points become days.
   */
  remainingPoints: number;
```

And the `weightedEligible` field of `MonthsAggregate`:

```ts
export interface MonthsAggregate {
  officeDays: number;
  /**
   * Σ of each month's `requiredPoints` across the months, in percent-points and
   * deliberately **un-rounded**. Nothing downstream rounds it either — ADR 0007
   * removed the year's single `ceil`, so these points reach `formatDays`
   * exactly as summed. Summing per-month round-ups instead would bill a
   * 260-weekday year at 40% about 110 days rather than the 104 it owes.
   */
  weightedEligible: number;
}
```

- [ ] **Step 7: Convert `FyStats`**

Replace the interface in `src/lib/rto.ts`:

```ts
export interface FyStats {
  fy: number;
  fyStartMonth: string;
  fyEndMonth: string;
  windowStartMonth: string;
  isPartialWindow: boolean; // windowStartMonth > fyStartMonth
  isFinalMonth: boolean; // monthKey === fyEndMonth
  /** Whole office days stamped across the window — a tally of stamps, not points. */
  cumulativeOffice: number;
  /**
   * Σ of each counted month's `requiredPoints`, in integer percent-points and
   * **never rounded**. The year holds its requirement exactly as the month
   * does; `formatDays` at the display edge is the only place it becomes days.
   */
  cumulativeRequiredPoints: number;
  /**
   * cumulativeOffice × 100 − cumulativeRequiredPoints. Negative means days are
   * owed. Both operands are integers, so `=== 0` *is* the level test — the same
   * reason MonthStats holds points rather than a fractional day.
   */
  balancePoints: number;
  /**
   * max(0, −balancePoints). Its sign test is exactly what it was before the
   * year stopped rounding: for an integer day count,
   * `cumulativeOffice × 100 < P` iff `cumulativeOffice < ceil(P / 100)`. So
   * every boolean keyed off "is the year owed" — `owedForYear` in stats.tsx
   * above all — kept its behaviour; only the magnitude reported got finer.
   */
  remainingNeededPoints: number;
}
```

- [ ] **Step 8: Convert `computeFyStats`**

Replace the doc comment's third paragraph and the body's arithmetic:

```ts
/**
 * Financial-year position through `monthKey`, inclusive.
 *
 * The year and its bounds are derived here from `monthKey` rather than taken
 * from the caller: they are a function of it, and a caller that passed both
 * could pass a July with another year's bounds and get isFinalMonth: false.
 *
 * Nothing here rounds. Prior months contribute un-rounded percent-points, the
 * displayed month adds its own, and the total stays in points all the way to
 * the screen — so a month that left 0.2 unworked is reported as 0.2 owed for
 * the year rather than as a whole day (ADR 0007). Every field is derived from
 * month keys and integers, so nothing consults the clock and the client can
 * recompute this after each tap.
 */
export function computeFyStats(
  monthKey: string,
  baseline: FyBaseline,
  monthStats: MonthStats
): FyStats {
  const fy = financialYearOf(monthKey);
  const { startMonth: fyStartMonth, endMonth: fyEndMonth } =
    financialYearBounds(fy);

  const cumulativeOffice = baseline.prior.officeDays + monthStats.officeDays;
  const cumulativeRequiredPoints =
    baseline.prior.weightedEligible + monthStats.requiredPoints;
  const balancePoints = cumulativeOffice * 100 - cumulativeRequiredPoints;
  return {
    fy,
    fyStartMonth,
    fyEndMonth,
    windowStartMonth: baseline.windowStartMonth,
    isPartialWindow: baseline.windowStartMonth > fyStartMonth,
    isFinalMonth: monthKey === fyEndMonth,
    cumulativeOffice,
    cumulativeRequiredPoints,
    balancePoints,
    remainingNeededPoints: Math.max(0, -balancePoints),
  };
}
```

- [ ] **Step 9: Replace `plural` with `dayCount`**

Delete the `plural` helper (`const plural = (n: number, one: string, many: string) => ...`) and put this in its place:

```ts
/**
 * Percent-points as a counted noun: `100` → "1 day", `20` → "0.2 days",
 * `250` → "2.5 days".
 *
 * Replaces the whole-number `plural` this file used to carry. Every quantity it
 * counts is points now, so the singular is keyed off exactly 100 points rather
 * than off `=== 1`: a 0.2 is plural, and only a whole single day is not. That
 * rule already existed inline in fyVerdict's month-remainder branch; this is
 * the one definition of it.
 */
const dayCount = (points: number, one: string, many: string) =>
  `${formatDays(points)} ${points === 100 ? one : many}`;
```

- [ ] **Step 10: Convert `fyVerdict`'s field reads and counted nouns**

Four edits inside `fyVerdict`. Every comment in the function stays — none of them is invalidated.

The surplus branch head:

```ts
  if (fy.balancePoints > 0) {
    const ahead = `${dayCount(fy.balancePoints, "day", "days")} ahead`;
```

The month-remainder branch inside it — the inline `=== 100` check goes away, since `dayCount` is now the one place that rule lives:

```ts
    // Points, not the fractional day: the month's shortfall can be 0.2, so both
    // the comparison and the number formatting have to be exact.
    if (monthStats.remainingPoints > 0) {
      return `${ahead} — this month's ${dayCount(
        monthStats.remainingPoints,
        "remaining day is",
        "remaining days are"
      )} covered.`;
    }
```

The zero-requirement guard:

```ts
  if (fy.cumulativeRequiredPoints === 0) {
    return "No requirement — the year owes nothing.";
  }

  if (fy.balancePoints === 0) {
```

And the owed tail:

```ts
  const owed = -fy.balancePoints;
  return fy.isFinalMonth
    ? `${dayCount(owed, "office day", "office days")} short of FY${fy.fy}'s full year${windowNote}.`
    : `${dayCount(owed, "more office day", "more office days")} needed to be level.`;
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS, all files.

- [ ] **Step 12: Convert `src/components/stats.tsx`**

Line 72, in `MonthBlock` — same boolean, new field name. The comment above it stays:

```tsx
  const owedForYear = fyStats === null || fyStats.remainingNeededPoints > 0;
```

In `FyBlock`, the destructure and the fill ratio:

```tsx
  const { cumulativeOffice, cumulativeRequiredPoints, balancePoints } = fyStats;
  // Full when nothing is required: an empty bar against a zero target would
  // read as no progress rather than no obligation. Otherwise floor, not
  // round: rounding renders 259/260 as a solid bar sitting directly above
  // "1 office day short", so the bar reads full only when the year is met.
  // Integer math on points, scaled by 10000 — no float divides a requirement
  // the rest of the app keeps exact.
  const fillPercent =
    cumulativeRequiredPoints === 0
      ? 100
      : Math.min(
          100,
          Math.floor((cumulativeOffice * 10000) / cumulativeRequiredPoints)
        );
```

And the figures line:

```tsx
        <p className="font-mono text-sm">
          {cumulativeOffice}/{formatDays(cumulativeRequiredPoints)}{" "}
          {fyStats.isFinalMonth ? "for the year" : "to date"}
          {balancePoints > 0 && (
            <span className="text-stamp"> +{formatDays(balancePoints)}</span>
          )}
        </p>
```

`formatDays` is already imported at the top of this file — no import change in this step.

- [ ] **Step 13: Type-check, test and lint**

```bash
npx tsc --noEmit && make test && make lint
```
Expected: no TypeScript output, Vitest all-pass, ESLint clean. A `Property 'balance' does not exist on type 'FyStats'` here means a call site was missed — grep for it: `grep -rn "cumulativeRequired\b\|\.balance\b\|remainingNeeded\b" src`.

- [ ] **Step 14: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts src/components/stats.tsx
git commit -m "feat: hold the financial-year requirement in un-rounded points"
```

---

## Task 2: `fyCarryNote`

**Files:**
- Modify: `src/lib/rto.ts` — new exported function after `fyVerdict`
- Test: `src/lib/rto.test.ts` — hoist two helpers, add `describe("fyCarryNote")`

- [ ] **Step 1: Hoist the shared fixtures out of the `fyVerdict` block**

`stats()` and `month()` currently live inside `describe("fyVerdict", ...)`. Move both, unchanged, to module scope immediately **above** `describe("fyVerdict", ...)` so the new block can use them. Then add a third fixture beside them:

```ts
// A month with a genuinely fractional remainder: 13 eligible at 40% is 5.2
// owed, so five stamped leaves 0.2. month() above cannot express this — its
// requirement is a whole 11 days, and a whole requirement can only leave whole
// remainders.
function partDayMonth(): MonthStats {
  return {
    eligibleDays: 13,
    officeDays: 5,
    requiredPoints: 520,
    remainingPoints: 20,
    targetPercent: 40,
    achievedPercent: 38,
    mandatedDays: 6,
    weeks: [],
  };
}
```

While there, retire the hand-rolled literal in the existing test `renders a part-day shortfall without float residue` — it builds exactly this object, and the comment on the test after it already warns against hand-rolled fixtures:

```ts
  it("renders a part-day shortfall without float residue", () => {
    const verdict = fyVerdict(stats(), partDayMonth()); // stats() defaults to +3 days
    expect(verdict).toBe(
      "3 days ahead — this month's 0.2 remaining days are covered."
    );
    expect(verdict).not.toContain("0.2000");
  });
```

- [ ] **Step 2: Write the failing tests**

Add a new block after `describe("fyVerdict", ...)` closes, and add `fyCarryNote` to the import list at the top of the file (it sits beside `fyVerdict` in the existing `from "@/lib/rto"` import).

```ts
describe("fyCarryNote", () => {
  it("says nothing when the month leaves no remainder", () => {
    expect(
      fyCarryNote(
        stats({
          balancePoints: -200,
          cumulativeOffice: 24,
          remainingNeededPoints: 200,
        }),
        month(0)
      )
    ).toBeNull();
  });

  it("says nothing when the year already covers the month's remainder", () => {
    // fyVerdict reports it covered two lines up; a note saying it is still owed
    // would argue with the sentence directly above it.
    expect(fyCarryNote(stats(), partDayMonth())).toBeNull();
  });

  it("names the year an unpaid fraction went into", () => {
    expect(
      fyCarryNote(
        stats({
          balancePoints: -20,
          cumulativeOffice: 5,
          cumulativeRequiredPoints: 520,
          remainingNeededPoints: 20,
        }),
        partDayMonth()
      )
    ).toBe(
      "Fractions carry — FY2027's total above already counts the 0.2 days this month left unworked, and settles it against a later month rather than raising next month's own target."
    );
  });

  it("says July has no later month to settle against", () => {
    const note = fyCarryNote(
      stats({
        balancePoints: -20,
        cumulativeOffice: 5,
        cumulativeRequiredPoints: 520,
        remainingNeededPoints: 20,
        isFinalMonth: true,
      }),
      partDayMonth()
    );
    expect(note).toBe(
      "Fractions carry, but only within the year — FY2027's total above already counts the 0.2 days this month left unworked, and July is its last month, so nothing settles it later."
    );
    // isFinalMonth is a month comparison, not a clock reading: eleven presses of
    // the next-month arrow reach a July that has not happened, so the sentence
    // must not speak of the year as over.
    expect(note).not.toContain("ended");
  });

  it("carries a whole-day remainder too — this is not a fraction-only note", () => {
    expect(
      fyCarryNote(
        stats({
          balancePoints: -200,
          cumulativeOffice: 24,
          remainingNeededPoints: 200,
        }),
        month(2)
      )
    ).toBe(
      "Fractions carry — FY2027's total above already counts the 2 days this month left unworked, and settles it against a later month rather than raising next month's own target."
    );
  });

  it("keeps the singular for exactly one unworked day", () => {
    expect(
      fyCarryNote(
        stats({
          balancePoints: -100,
          cumulativeOffice: 25,
          remainingNeededPoints: 100,
        }),
        month(1)
      )
    ).toContain("counts the 1 day this month left unworked");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/rto.test.ts -t "fyCarryNote"`
Expected: FAIL with `fyCarryNote is not a function` (or a TypeScript-flavoured import error from Vitest).

- [ ] **Step 4: Implement `fyCarryNote`**

Append to `src/lib/rto.ts`, directly after `fyVerdict`:

```ts
/**
 * Where a month's unpaid fraction went, or `null` when there is nothing to
 * explain.
 *
 * Null unless the month has a remainder **and** the year is still owed. The
 * second condition is not redundant: when the year is ahead, `fyVerdict`
 * already reports the month's remainder as covered, and a note insisting it is
 * still owed would argue with the sentence directly above it on screen.
 *
 * Not a clause bolted onto fyVerdict's eight branches — most of them have no
 * month remainder to speak about, and the two that do already say their piece.
 * A separate function is also a separate assertion.
 *
 * Copy lives here rather than in the component for the reason fyVerdict's does:
 * Vitest runs without a DOM, so a string assembled inside JSX cannot be
 * asserted.
 */
export function fyCarryNote(
  fy: FyStats,
  monthStats: MonthStats
): string | null {
  if (monthStats.remainingPoints === 0) return null;
  if (fy.remainingNeededPoints === 0) return null;

  const unworked = `${dayCount(
    monthStats.remainingPoints,
    "day",
    "days"
  )} this month left unworked`;

  // `isFinalMonth` is a month comparison — monthKey === fyEndMonth — and reads
  // no clock, so this branch is reachable for a July that has not happened.
  // "July is its last month" is true either way; "the year ended short" is not.
  if (fy.isFinalMonth) {
    return `Fractions carry, but only within the year — FY${fy.fy}'s total above already counts the ${unworked}, and July is its last month, so nothing settles it later.`;
  }
  return `Fractions carry — FY${fy.fy}'s total above already counts the ${unworked}, and settles it against a later month rather than raising next month's own target.`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS, all files — the hoist in Step 1 must not have broken the `fyVerdict` block.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: say where a month's unpaid fraction went"
```

---

## Task 3: Render the carry note

No test: Vitest runs in a `node` environment and this project unit-tests `src/lib/rto.ts` only. The sentence itself is already covered by Task 2; this task only wires it in.

**Files:**
- Modify: `src/components/stats.tsx` — import list, `FyBlock`

- [ ] **Step 1: Import it**

Add `fyCarryNote` to the existing import from `@/lib/rto` at the top of `src/components/stats.tsx`, keeping the list alphabetical as it already is — it goes between `formatMonth` and `fyVerdict`:

```tsx
import {
  DEFAULT_RTO_PERCENT,
  formatDays,
  formatMonth,
  fyCarryNote,
  fyVerdict,
  monthMeter,
  type FyStats,
  type MonthStats,
} from "@/lib/rto";
```

- [ ] **Step 2: Call it and render it**

In `FyBlock`, after the `fillPercent` computation:

```tsx
  const carryNote = fyCarryNote(fyStats, monthStats);
```

And at the end of the returned `<section>`, after the verdict paragraph:

```tsx
      <p className="text-sm text-fade">{fyVerdict(fyStats, monthStats)}</p>
      {carryNote && <p className="text-sm text-fade">{carryNote}</p>}
    </section>
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit && make test && make lint
```
Expected: no TypeScript output, Vitest all-pass, ESLint clean.

- [ ] **Step 4: Verify it in the running app**

```bash
npm run dev
```

Open `http://localhost:3000/?m=2026-08` and check the FY block reads its figures with decimals (`5/5.2 to date`, not `5/520`), and that the carry sentence appears under the verdict when the month is short and the year is owed. Cycle a weekday to `office` and back and confirm the sentence appears and disappears without a reload — the client recomputes `computeFyStats` from local state on every tap.

If the page serves stale chunks or shows behaviour that does not match the source, a stale service worker is registered on `localhost:3000`: unregister it in DevTools → Application → Service Workers, then hard-reload.

- [ ] **Step 5: Commit**

```bash
git add src/components/stats.tsx
git commit -m "feat: show the carry note under the year's verdict"
```

---

## Task 4: Documentation

Docs-only. No test step; `make lint` does not read Markdown.

**Files:**
- Create: `docs/decisions/0007-fractional-financial-year-total.md`
- Modify: `docs/decisions/0005-financial-year-carryover.md`, `docs/decisions/0006-fractional-monthly-requirement.md`, `docs/architecture.md`, `CLAUDE.md`

- [ ] **Step 1: Write ADR 0007**

Create `docs/decisions/0007-fractional-financial-year-total.md`:

```markdown
# 0007 — The financial-year total is fractional too

## Context

ADR 0006 made the month's requirement exact: 13 eligible days at 40% is 5.2, not
6. The fraction was never forgiven — `aggregateMonths` sums each month's
un-rounded `requiredPoints` into `weightedEligible`, and the financial year is
where it settles.

`computeFyStats` then hid it:

    cumulativeRequired = ceil(weightedEligible / 100)     // 520 -> 6

A user who owed 5.2 and stamped 5 was told the year needed **1 more office day**.
The carried debt is 0.2. The figure shown a line earlier — "0.2 to go" on the
month card — vanished and came back as a whole day, which reads as the fraction
being rounded away rather than carried.

ADR 0005 put the `ceil` there on the reasoning that a fifth of a day cannot be
worked. That is a statement about **what clears the debt**, not about **how large
the debt is**, and the first survives without it.

## Decision

The financial year holds its requirement in un-rounded percent-points, exactly as
the month does. There is no `Math.ceil` anywhere in the FY path.

    cumulativeRequiredPoints = Σ (eligibleDays_m × percent_m)   // never divided
    balancePoints            = cumulativeOffice × 100 − cumulativeRequiredPoints
    remainingNeededPoints    = max(0, −balancePoints)

**No verdict boundary moves.** For an integer `cumulativeOffice`:

    cumulativeOffice × 100 ≥ P   ⟺   cumulativeOffice ≥ ceil(P / 100)

Clearing a 104.4-day year still takes 105 whole days. `remainingNeededPoints > 0`
is true in exactly the cases `remainingNeeded > 0` was, so `owedForYear` — the
flag that mutes the month card's alarm and celebration colours — is unchanged.

What moves is the split between *level* and *ahead*, in the direction of the
truth: 20 days stamped against 19.8 owed used to report `balance === 0`, "Level —
no days banked", and now reports +0.2, which is what the year really credits
against a later month.

The progress block also gains `fyCarryNote`, one state-aware sentence naming
where a month's unpaid fraction went. It renders only when the month has a
remainder **and** the year is still owed — when the year is ahead, `fyVerdict`
already reports the remainder covered.

Rejected alternatives:

- **Floats instead of points** (`cumulativeRequired: 5.2`). Puts `balance === 0`
  — the level test — back on float arithmetic, the one thing ADR 0006 introduced
  points to avoid. Worse, keeping the field names lets every call site compile
  against a number that silently means something else; renaming all three made
  the compiler find them.
- **Keeping the `ceil` for display and adding exact fields beside it.** Two
  requirement figures for one year. ADR 0006 already learned that a day-valued
  sibling next to a points field is an invitation to compare the wrong one, and
  deleted `requiredDays` for it.
- **Folding the carry into next month's own target** — next month asks for its
  own 5.2 plus 0.2 carried. The most literal reading of "carried over to next
  month", but the month stops being `eligible × percent`, which is the figure the
  employer states, and the month card and the FY line would bill the same 0.2
  twice.
- **An always-on caption stating the carry rule.** Cannot be missed, but it is a
  sentence that never changes, where every other string in `rto.ts` is chosen for
  the state it describes.

## Consequences

- ADR 0005's `cumulativeRequired = ceil(…)` and ADR 0006's "the year is stricter
  than the sum of its months" are both superseded, and marked in place.
- **Per-month points now sum to the FY figure exactly.** The FY line stays the
  authoritative one, but for a different reason than before: it is the only
  figure that spans the window, not because it rounds differently.
- `Level` becomes a rare branch of `fyVerdict` — it needs the year's total to
  land on a whole day *and* be met exactly. Most months now read as slightly
  ahead or slightly behind, which is what they are.
- The FY bar gets more accurate as a side effect: 5 stamped against 5.2 was drawn
  at `floor(5/6) = 83%` and is now 96%. Its `floor` and its `=== 0 → 100%` guard
  both stay, for the reasons already commented at the call site.
- A final month can now report a sub-day shortfall — "0.4 office days short of
  FY2027's full year" — where clearing it takes a whole day. The verdict states
  the size of the debt and the carry note states that the year ends in July;
  neither invents a number, and rounding one of them up would put a figure on
  screen that no arithmetic in the app produces.
- `monthMeter` is untouched. `extra` still counts whole surplus rings rather than
  the exact surplus: `slots` rounds the requirement up, so `extra` can only
  understate what the year credits, and understating is the safe direction.
- No schema change, no migration, no query change. `FyBaseline` — the only part
  of this that crosses the server/client boundary — keeps its shape.
```

- [ ] **Step 2: Amend ADR 0005 in place**

In `docs/decisions/0005-financial-year-carryover.md`, immediately after the fenced code block in the Decision section (the one ending `balance = cumulativeOffice − cumulativeRequired`), insert:

```markdown
**Amended 2026-09-01 by ADR 0007:** the `ceil` is gone. The year now holds
`cumulativeRequiredPoints = Σ (eligibleDays_m × percent_m)` in points and
`balancePoints = cumulativeOffice × 100 − cumulativeRequiredPoints`. No verdict
boundary moved — for an integer day count the two forms agree on whether the year
is owed — but every magnitude reported is now exact.
```

And in the Consequences list, extend the bullet beginning "Per-month figures no
longer sum to the FY figure":

```markdown
- Per-month figures no longer sum to the FY figure, because the year rounds once. The FY
  line is authoritative.
  **Amended 2026-09-01 by ADR 0007:** the year no longer rounds, so per-month
  points do sum to the FY figure exactly. The FY line stays authoritative for a
  different reason — it is the only figure that spans the window.
```

- [ ] **Step 3: Amend ADR 0006 in place**

In `docs/decisions/0006-fractional-monthly-requirement.md`, extend the first
Consequences bullet:

```markdown
- **The year is stricter than the sum of its months.** A year totalling 19.8 still asks
  for 20, because a fifth of a day cannot be worked. "5.2 required this month" on screen
  and a year demanding a whole extra day coexist by design; the FY line is the
  authoritative one, as ADR 0005 already said.
  **Amended 2026-09-01 by ADR 0007:** it no longer is. The year asks for 19.8 and
  reports a 0.2 surplus at 20 days stamped. Clearing the year still takes 20 whole
  days — an integer day count cannot land on 19.8 — so what changed is the figure
  on screen, not what it takes to comply.
```

- [ ] **Step 4: Update `docs/architecture.md`**

Two bullets. The first, at `:48-51`, changes only its last clause:

```markdown
- Required office days = `eligible × targetPercent` in integer percent-points,
  **un-rounded** — 13 eligible at 40% is 520 points, i.e. 5.2 days. `targetPercent`
  comes from `rto_targets` for that month, defaulting to 40. Neither the month nor
  the financial year rounds (see below)
```

The second, at `:57-58`, is replaced:

```markdown
- FY required office days = `Σ(eligible_m × percent_m)` in percent-points, un-rounded —
  no rounding step anywhere. Clearing a year that owes 104.4 still takes 105 whole days,
  since office days are integers; the figure is exact, the boundary is unchanged
```

- [ ] **Step 5: Update `CLAUDE.md`**

In the paragraph beginning "**Compliance is cumulative within a financial year**", replace the two sentences from "`computeFyStats` adds only" through "and sum those.":

```markdown
`computeFyStats` adds only the displayed month's own contribution to that already-summed
baseline and **rounds nothing** — the year holds its requirement in points exactly as the
month does, and `formatDays` at the display edge is the only place points become days.
Rounding per month instead costs about six office days a year, so never round a month's
`requiredPoints` to whole days and sum those. Dropping the year's `ceil` (ADR 0007)
moved no verdict boundary: for an integer day count, `office × 100 ≥ P` iff
`office ≥ ceil(P / 100)`, so a year owing 104.4 still takes 105 whole days to clear —
only the reported magnitude got finer. `fyCarryNote` is the one sentence that says so.
```

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0007-fractional-financial-year-total.md \
        docs/decisions/0005-financial-year-carryover.md \
        docs/decisions/0006-fractional-monthly-requirement.md \
        docs/architecture.md CLAUDE.md
git commit -m "docs: record the un-rounded financial-year total"
```

---

## Final verification

- [ ] **Step 1: Full suite, types and lint from a clean state**

```bash
npx tsc --noEmit && make test && make lint
```
Expected: no TypeScript output, Vitest all-pass, ESLint clean.

- [ ] **Step 2: Confirm no `ceil` survives in the FY path**

```bash
grep -n "Math.ceil" src/lib/rto.ts
```
Expected: exactly one hit — `const slots = Math.ceil(requiredPoints / 100)` in `monthMeter`, which rounds the month's *ring count* and is deliberately out of scope. Any hit inside `computeFyStats` is a missed edit.

- [ ] **Step 3: Confirm every old field name is gone**

```bash
grep -rn "cumulativeRequired\b\|remainingNeeded\b\|\.balance\b" src docs CLAUDE.md
```
Expected: hits only inside `docs/decisions/0005-*.md` and `docs/decisions/0006-*.md`, where the historical record deliberately keeps them. No hits under `src/`.

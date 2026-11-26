# Mark Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tap-to-cycle with a palette of five SVG marks (Office, Leave, Holiday, Training, Erase): pick one, then tap days to apply it.

**Architecture:** The tap rule (`applyMark`) and its screen-reader copy (`tapHint`) go in `src/lib/rto.ts`, where Vitest can assert them. `status-icons.tsx` draws the marks, `mark-palette.tsx` is a stateless toolbar, and a new client `calendar-board.tsx` owns the active mark *outside* `<Calendar>`'s `key={monthKey}`, so the selection survives month changes. `<Calendar>` renders the palette through a `palette` slot between the stats and the grid. Saving, stats and schema are untouched.

**Tech Stack:** TypeScript, Vitest (node environment), React 19, Next 16 App Router, Tailwind v4.

Spec: `docs/superpowers/specs/2026-11-26-mark-palette-design.md`

No schema change, no migration.

---

### Task 1: `applyMark` and `tapHint`

**Files:**
- Modify: `src/lib/rto.ts` — add directly after `isEligible` (~line 385)
- Test: `src/lib/rto.test.ts`

- [x] **Step 1: Write the failing tests**

Add `applyMark`, `tapHint`, `type DayStatus` (if not already imported) and `type Mark` to the import list at the top of `src/lib/rto.test.ts`, then append:

```ts
describe("applyMark", () => {
  const statuses: (DayStatus | null)[] = [
    null,
    "office",
    "leave",
    "holiday",
    "training",
  ];
  const marks: DayStatus[] = ["office", "leave", "holiday", "training"];

  it("leaves every day unchanged when no mark is selected", () => {
    for (const current of statuses) {
      expect(applyMark(current, null)).toBe(current);
    }
  });

  it("clears every day under erase", () => {
    for (const current of statuses) {
      expect(applyMark(current, "erase")).toBeNull();
    }
  });

  it("clears a day that already carries the selected mark", () => {
    for (const mark of marks) {
      expect(applyMark(mark, mark)).toBeNull();
    }
  });

  it("writes the selected mark over any other status", () => {
    for (const current of statuses) {
      for (const mark of marks) {
        if (current === mark) continue;
        expect(applyMark(current, mark)).toBe(mark);
      }
    }
  });
});

describe("tapHint", () => {
  it("asks for a mark when none is selected", () => {
    expect(tapHint("office", null)).toBe("Pick a mark first.");
    expect(tapHint(null, null)).toBe("Pick a mark first.");
  });

  it("names the status a tap would write", () => {
    expect(tapHint(null, "office")).toBe("Tap to mark office.");
    expect(tapHint("leave", "training")).toBe("Tap to mark training.");
  });

  it("says clear when the tap would clear", () => {
    expect(tapHint("holiday", "holiday")).toBe("Tap to clear.");
    expect(tapHint("office", "erase")).toBe("Tap to clear.");
  });

  it("says nothing changes when erasing an empty day", () => {
    expect(tapHint(null, "erase")).toBe("Nothing to erase.");
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/rto.test.ts -t "applyMark|tapHint"`
Expected: FAIL, `applyMark is not a function` (or an import error).

- [x] **Step 3: Implement**

In `src/lib/rto.ts`, directly after `isEligible`:

```ts
/** A palette selection: a status to write, or `"erase"` to clear a day. */
export type Mark = DayStatus | "erase";

/**
 * What a tap on a weekday writes under the active palette mark. `null` means
 * WFH — delete the row. With no mark selected nothing changes; tapping a day
 * that already carries the mark clears it, so Erase is a convenience rather
 * than the only way back to WFH. Callers save nothing when the result equals
 * `current`.
 */
export function applyMark(
  current: DayStatus | null,
  mark: Mark | null
): DayStatus | null {
  if (mark === null) return current;
  if (mark === "erase" || mark === current) return null;
  return mark;
}

/** The closing sentence of a day cell's aria-label: what a tap will do. */
export function tapHint(current: DayStatus | null, mark: Mark | null): string {
  if (mark === null) return "Pick a mark first.";
  const next = applyMark(current, mark);
  if (next === current) return "Nothing to erase.";
  if (next === null) return "Tap to clear.";
  return `Tap to mark ${next}.`;
}
```

(`next === current` with a non-null mark can only happen for `"erase"` on an empty day: every other mark either writes a different status or clears a set one.)

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/rto.test.ts`
Expected: PASS, all tests.

- [x] **Step 5: Commit**

```bash
git add src/lib/rto.ts src/lib/rto.test.ts
git commit -m "feat: add the palette's tap rule and its hint"
```

---

### Task 2: Colour tokens and palette CSS

`stats.tsx` uses the `holiday` token as the "ahead" green, for covered rings (`border-holiday`) and "target met" (`text-holiday`). Recolouring `holiday` to wine would recolour those, so they move to a new `credit` token that keeps the green.

**Files:**
- Modify: `src/app/globals.css` — `@theme` block (lines 1–18); append the two new rules after `.stamp-in`'s reduced-motion block
- Modify: `src/components/stats.tsx:109` and `:136`
- Modify: `docs/superpowers/specs/2026-11-26-mark-palette-design.md` — record the `credit` token

- [x] **Step 1: Retoken `@theme`**

Replace the `--color-leave` and `--color-holiday` lines with:

```css
  /* Each status colour follows its palette icon: a tree reads green, a wine
     glass wine. Leave took holiday's former green; the old slate #5a6b8c
     retired. Holiday's wine is 6.75:1 on paper, over the 4.5:1 text floor. */
  --color-leave: #3e7a57;
  --color-holiday: #8a3a5c;
  /* "Ahead of the year": covered rings and "target met". The same green as
     leave, but a separate token — it is a verdict, not a status, and must not
     move when a status colour does. */
  --color-credit: #3e7a57;
```

- [x] **Step 2: Point `stats.tsx` at `credit`**

In `src/components/stats.tsx`, change `"border-dashed border-holiday bg-transparent"` to `"border-dashed border-credit bg-transparent"` (line 109) and `"text-holiday"` to `"text-credit"` (line 136).

Run: `grep -rn "holiday" src/components/stats.tsx`
Expected: no output.

- [x] **Step 3: Add the icon tint and pulse rules**

Append to `src/app/globals.css`, after the `@media (prefers-reduced-motion: reduce) { .stamp-in … }` block:

```css
/* Two-tone marks: the fill is the stroke's own colour, thinned. A class, not a
   fill attribute, because color-mix is not valid in a presentation attribute. */
.icon-tint {
  fill: color-mix(in srgb, currentColor 18%, transparent);
}

/* A tap with no mark selected points at the palette instead of doing nothing
   silently. Retriggered by remounting the toolbar with a new key. */
.palette-pulse {
  animation: palette-pulse 600ms ease-out;
}

@keyframes palette-pulse {
  30% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-ink) 20%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .palette-pulse {
    animation: none;
  }
}
```

- [x] **Step 4: Record the token in the spec**

In the spec, append this paragraph after the "Colours follow the icons" paragraph:

```markdown
`stats.tsx` used `holiday` as its "ahead" green (covered rings, "target
met"). Those move to a new `credit` token holding the same green, so a
verdict colour no longer moves with a status colour.
```

- [x] **Step 5: Lint and commit**

Run: `make lint`
Expected: no errors.

```bash
git add src/app/globals.css src/components/stats.tsx docs/superpowers/specs/2026-11-26-mark-palette-design.md
git commit -m "style: recolour leave and holiday; give the year's credit its own token"
```

---

### Task 3: `status-icons.tsx`

**Files:**
- Create: `src/components/status-icons.tsx`

- [x] **Step 1: Write the component**

```tsx
import type { ReactNode } from "react";
import type { Mark } from "@/lib/rto";

// Every mark needs a colour; a total Record fails to compile when a status is
// added, where a ternary would paint the newcomer in the last branch's colour.
export const MARK_TEXT: Record<Mark, string> = {
  office: "text-stamp",
  leave: "text-leave",
  holiday: "text-holiday",
  training: "text-training",
  erase: "text-fade",
};

// 24×24, 1.5px stroke in currentColor. Shapes marked icon-tint take a thinned
// fill of the same colour, which is what makes them two-tone.
const PATHS: Record<Mark, ReactNode> = {
  office: (
    <>
      <path
        className="icon-tint"
        d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h7A1.5 1.5 0 0 1 15 4.5V21"
      />
      <path className="icon-tint" d="M15 9h3.5a1.5 1.5 0 0 1 1.5 1.5V21" />
      <path d="M3 21h18" />
      <path d="M8 7h1.5M11 7h1.5M8 11h1.5M11 11h1.5M8 15h1.5M11 15h1.5" />
      <path d="M17 13h.5M17 16.5h.5" />
    </>
  ),
  leave: (
    <>
      <path
        className="icon-tint"
        d="M12 3a5 5 0 0 0-4.6 7A4 4 0 0 0 9 17h6a4 4 0 0 0 1.6-7A5 5 0 0 0 12 3z"
      />
      <path d="M12 21v-9M12 14.5l-2.5-2.5M12 13l2-2" />
      <path d="M8 21h8" />
    </>
  ),
  holiday: (
    <>
      <path
        className="icon-tint"
        d="M7.5 7.5h9a4.5 4.5 0 0 1-9 0z"
      />
      <path d="M7 3h10l-.5 4.5a4.5 4.5 0 0 1-9 0z" />
      <path d="M12 12v8M8.5 20.5h7" />
    </>
  ),
  training: (
    <>
      <path
        className="icon-tint"
        d="M3 5.5c2.5-1 5.5-1 9 1 3.5-2 6.5-2 9-1V19c-2.5-1-5.5-1-9 1-3.5-2-6.5-2-9-1z"
      />
      <path d="M12 6.5V20" />
    </>
  ),
  erase: (
    <>
      <path
        className="icon-tint"
        d="M14.1 3.8a1.5 1.5 0 0 1 2.1 0l4 4a1.5 1.5 0 0 1 0 2.1L11 19H7l-3.2-3.2a1.5 1.5 0 0 1 0-2.1z"
      />
      <path d="M9 8.9l6.1 6.1" />
      <path d="M11 19h9" />
    </>
  ),
};

/**
 * One palette mark as a two-tone inline SVG — never an emoji, which renders
 * differently on every platform and ignores the palette's colours. Decorative:
 * the button or cell around it carries the accessible name.
 */
export function MarkIcon({
  mark,
  className = "",
}: {
  mark: Mark;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {PATHS[mark]}
    </svg>
  );
}
```

The holiday glass has its outline drawn as a full bowl, and the tint fills only the lower half, so it reads as wine in a glass.

- [x] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/components/status-icons.tsx
git commit -m "feat: draw the five marks as two-tone SVG"
```

---

### Task 4: `mark-palette.tsx`

**Files:**
- Create: `src/components/mark-palette.tsx`

- [x] **Step 1: Write the component**

```tsx
import type { Mark } from "@/lib/rto";
import { MARK_TEXT, MarkIcon } from "@/components/status-icons";

const MARKS: Mark[] = ["office", "leave", "holiday", "training", "erase"];

const MARK_LABEL: Record<Mark, string> = {
  office: "Office",
  leave: "Leave",
  holiday: "Holiday",
  training: "Training",
  erase: "Erase",
};

// Literal class strings, so Tailwind's scanner sees every one.
const MARK_ACTIVE: Record<Mark, string> = {
  office: "border-stamp bg-stamp/10 text-stamp",
  leave: "border-leave bg-leave/10 text-leave",
  holiday: "border-holiday bg-holiday/10 text-holiday",
  training: "border-training bg-training/10 text-training",
  erase: "border-ink bg-ink/5 text-ink",
};

/**
 * Stateless: the active mark lives in CalendarBoard, above Calendar's month
 * key. `pulseKey` remounts the toolbar to replay the pulse; 0 means never
 * pulsed.
 */
export function MarkPalette({
  active,
  onSelect,
  pulseKey,
}: {
  active: Mark | null;
  onSelect: (mark: Mark | null) => void;
  pulseKey: number;
}) {
  return (
    <div
      key={pulseKey}
      role="toolbar"
      aria-label="Marks"
      className={`flex flex-wrap gap-2 ${pulseKey > 0 ? "palette-pulse" : ""}`}
    >
      {MARKS.map((mark) => {
        const on = active === mark;
        return (
          <button
            key={mark}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(on ? null : mark)}
            className={`flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[11px] tracking-widest uppercase transition-colors ${
              on ? MARK_ACTIVE[mark] : "border-rule bg-paper text-ink hover:bg-ink/5"
            }`}
          >
            <MarkIcon mark={mark} className={`size-5 ${MARK_TEXT[mark]}`} />
            {MARK_LABEL[mark]}
          </button>
        );
      })}
    </div>
  );
}
```

- [x] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/components/mark-palette.tsx
git commit -m "feat: add the mark palette toolbar"
```

---

### Task 5: Wire the palette into the calendar

`Calendar` gains three required props, so `page.tsx` must switch to `CalendarBoard` in the same commit or the build breaks.

**Files:**
- Modify: `src/components/calendar.tsx`
- Create: `src/components/calendar-board.tsx`
- Modify: `src/app/page.tsx` — import (line 22) and the `<Calendar>` element with its comment (~lines 240–254)

- [x] **Step 1: Calendar imports and constants**

In `src/components/calendar.tsx`:

- Change the `react` import to `import { useRef, useState, type ReactNode } from "react";`
- Add `applyMark`, `tapHint` and `type Mark` to the `@/lib/rto` import.
- Add `import { MARK_TEXT, MarkIcon } from "@/components/status-icons";`
- Delete the `CYCLE` constant.
- Delete the `STATUS_CLASS` constant and its comment. `MARK_TEXT` replaces it.

- [x] **Step 2: Replace `DayMark`**

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
  // The text marks this replaced were struck through when muted; line-through
  // draws nothing on an SVG. The hatch and the aria-label already say "not
  // counted", so the fade alone quiets the mark.
  const mutedClass = muted ? "opacity-40" : "";
  if (status === "office") {
    return (
      <span
        className={`stamp-ring inline-flex p-1 ${stamped ? "stamp-in" : ""} ${mutedClass}`}
      >
        <MarkIcon mark="office" className="size-5" />
      </span>
    );
  }
  return (
    <MarkIcon
      mark={status}
      className={`size-6 ${MARK_TEXT[status]} ${mutedClass}`}
    />
  );
}
```

- [x] **Step 3: New props**

Add to the destructured props and their type:

```tsx
  mark,
  palette,
  onUnmarkedTap,
```

```tsx
  /** The active palette mark, held by CalendarBoard above this component's key. */
  mark: Mark | null;
  /** The palette, rendered between the stats and the grid. */
  palette: ReactNode;
  /** Called when a day is tapped with no mark selected, to pulse the palette. */
  onUnmarkedTap: () => void;
```

- [x] **Step 4: Replace `cycle` with `tap`**

Replace the whole `cycle` function with:

```tsx
  function tap(date: string) {
    if (mark === null) {
      onUnmarkedTap();
      showToast("Pick a mark above first.");
      return;
    }
    const current = entries[date] ?? null;
    const next = applyMark(current, mark);
    if (next === current) return;

    setEntries((prev) => {
      const updated = { ...prev };
      if (next === null) delete updated[date];
      else updated[date] = next;
      return updated;
    });
    setJustStamped(next === "office" ? date : null);

    setDayStatus(date, next).catch(() => {
      setEntries((prev) => {
        const reverted = { ...prev };
        if (current === null) delete reverted[date];
        else reverted[date] = current;
        return reverted;
      });
      showToast("Couldn't save — day reverted.");
    });
  }
```

- [x] **Step 5: Render the palette, the tap and the hint**

- Directly after `<Stats stats={stats} fyStats={fyStats} />`, add `{palette}`.
- On the day `<button>`: change `onClick={() => cycle(date)}` to `onClick={() => tap(date)}`.
- Replace its `aria-label` expression with:

```tsx
                    aria-label={
                      mandated
                        ? `${date}: Mandated work from home${
                            status
                              ? `, ${STATUS_LABEL[status]} recorded but not counted`
                              : ""
                          }. ${tapHint(status, mark)}`
                        : `${date}: ${STATUS_LABEL[status ?? "wfh"]}. ${tapHint(status, mark)}`
                    }
```

- Replace the help paragraph's text with:

```tsx
        Pick a mark, then tap days. Tap a marked day again to clear it.
        Untouched days count as work from home. Hatched days are mandated work
        from home — they don&apos;t count toward the requirement.
```

Run: `grep -n "cycle\|CYCLE\|STATUS_CLASS" src/components/calendar.tsx`
Expected: no output.

- [x] **Step 6: Create `calendar-board.tsx`**

```tsx
"use client";

import { useEffect, useState, type ComponentProps } from "react";
import type { Mark } from "@/lib/rto";
import { Calendar } from "@/components/calendar";
import { MarkPalette } from "@/components/mark-palette";

type BoardProps = Omit<
  ComponentProps<typeof Calendar>,
  "mark" | "palette" | "onUnmarkedTap"
>;

/**
 * Holds the active mark one level above Calendar so that changing months —
 * which remounts Calendar — keeps the selection.
 */
export function CalendarBoard(props: BoardProps) {
  const [mark, setMark] = useState<Mark | null>(null);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMark(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    // Keyed by month: search-param navigation re-renders rather than remounts,
    // and Calendar seeds its state from initialEntries only on mount. Without
    // the key, sliding months keeps the previous month's entries and the new
    // month renders blank.
    <Calendar
      key={props.monthKey}
      {...props}
      mark={mark}
      onUnmarkedTap={() => setPulseKey((k) => k + 1)}
      palette={
        <MarkPalette active={mark} onSelect={setMark} pulseKey={pulseKey} />
      }
    />
  );
}
```

- [x] **Step 7: Switch `page.tsx` to the board**

In `src/app/page.tsx`:

- Change line 22 to `import { CalendarBoard } from "@/components/calendar-board";`
- Replace the keyed-by-month comment and `<Calendar key={monthKey}` with the following. Leave every other prop and the mandates comment as they are:

```tsx
      {/* CalendarBoard keys Calendar by month; see the comment there. */}
      <CalendarBoard
        monthKey={monthKey}
```

Run: `grep -n "<Calendar\b\|key={monthKey}" src/app/page.tsx`
Expected: no output.

- [x] **Step 8: Update CLAUDE.md**

In `CLAUDE.md`:

- Replace the sentence beginning "**`<Calendar>` must keep its `key={monthKey}`.**" with: "**`<Calendar>` must keep its `key={monthKey}`**, which `CalendarBoard` sets."
- Leave the rest of that paragraph as it is, then add this sentence after it: "The active palette mark lives in `CalendarBoard`, above that key, so it survives month changes."
- In the Data flow paragraph, replace "tapping a weekday cycles `null → office → leave → holiday → training → null`" with "tapping a weekday applies the active palette mark via `applyMark` (tapping a day that already has it clears it; with no mark selected nothing changes)".

- [x] **Step 9: Verify and commit**

Run: `npx tsc --noEmit && make lint && make test`
Expected: no type errors, no lint errors, all tests pass.

```bash
git add src/components/calendar.tsx src/components/calendar-board.tsx src/app/page.tsx CLAUDE.md
git commit -m "feat: mark days from the palette instead of cycling"
```

---

### Task 6: Browser check

- [x] **Step 1: Run the app**

Run `npm run dev` and open http://localhost:3000. If the app serves stale chunks, unregister the old service worker on localhost:3000 first.

- [x] **Step 2: Walk the spec's checklist**

1. Tap a day with no mark selected: the palette pulses, the toast reads "Pick a mark above first.", and nothing is saved (check the Network tab).
2. Pick Office and tap three days: they stamp in and the stats update.
3. Tap one of them again: it clears.
4. Switch to Leave and tap an office day: it becomes a green tree.
5. Pick Erase and tap a leave day: it clears. Tap an empty day: nothing happens.
6. Reload: the marks persist.
7. Move to the next month and back: the selected mark is still active.
8. Press Escape: the mark is deselected.
9. A stamp on a mandated day renders faded.
10. Imported holidays show the wine glass.
11. Covered rings and "target met" are still green.
12. At a 375px width: the palette wraps cleanly and each icon is legible in a cell.

- [x] **Step 3: Tick the checklist in this plan and commit**

```bash
git add docs/superpowers/plans/2026-11-26-mark-palette.md
git commit -m "docs: tick the mark palette browser check"
```

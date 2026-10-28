# Today Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Today button between the month arrows that jumps to the browser's current month.

**Architecture:** Extract the calendar's client-side today read into a shared `useToday()` hook; a small client component derives the target month with the existing `toMonthKey` and renders a link, or an inert span when already there. `page.tsx` stays a server component.

**Tech Stack:** Next.js App Router, React 19 `useSyncExternalStore`, Tailwind v4.

Spec: `docs/superpowers/specs/2026-10-28-today-button-design.md`

No new pure logic: `toMonthKey("YYYY-MM-DD")` is already covered in `src/lib/rto.test.ts`, and Vitest runs in `node`, so the hook and component are verified in the browser.

---

### Task 1: Extract `useToday()`

**Files:**
- Create: `src/lib/use-today.ts`
- Modify: `src/components/calendar.tsx` (imports; the inline `useSyncExternalStore` at ~line 120)

- [ ] **Step 1: Create the hook**

```ts
import { useSyncExternalStore } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Today as a local `YYYY-MM-DD`, read from the browser's clock; `null` during
 * SSR and hydration, so server output stays timezone-independent. The grid's
 * highlight and the Today button share this one definition so they cannot
 * disagree about which day it is.
 */
export function useToday(): string | null {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const now = new Date();
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    },
    () => null
  );
}
```

- [ ] **Step 2: Use it in `calendar.tsx`**

Replace the inline block with:

```ts
  // Server renders no "today" highlight; the client fills it in on hydration.
  const today = useToday();
```

Import `useToday` from `@/lib/use-today` and drop `useSyncExternalStore` from the React import.

- [ ] **Step 3: Run `make test && make lint`** — expected: pass.

- [ ] **Step 4: Commit** — `refactor: share the browser's today between calendar and nav`

### Task 2: `<TodayLink>` in the nav

**Files:**
- Create: `src/components/today-link.tsx`
- Modify: `src/app/page.tsx` (the `<nav aria-label="Change month">`)

- [ ] **Step 1: Create the component**

```tsx
"use client";

import Link from "next/link";
import { toMonthKey } from "@/lib/rto";
import { useToday } from "@/lib/use-today";

const BOX = "border border-rule px-3 py-1.5 font-mono text-sm";

/**
 * Jumps to the month holding the browser's today — not the server's, which on
 * Vercel is UTC and would land on the previous month early on the 1st. Before
 * hydration there is no browser date, so it falls back to `/` and lets the
 * server choose.
 */
export function TodayLink({ monthKey }: { monthKey: string }) {
  const today = useToday();
  const target = today ? toMonthKey(today) : null;

  if (target === monthKey) {
    return (
      <span aria-current="date" className={`${BOX} text-fade`}>
        Today
      </span>
    );
  }

  return (
    <Link href={target ? `/?m=${target}` : "/"} className={`${BOX} hover:bg-ink/5`}>
      Today
    </Link>
  );
}
```

- [ ] **Step 2: Render it between the arrows in `page.tsx`**

```tsx
            <TodayLink monthKey={monthKey} />
```

with `import { TodayLink } from "@/components/today-link";`.

- [ ] **Step 3: Run `make test && make lint && npm run build`** — expected: pass.

- [ ] **Step 4: Manual check in the browser** — from another month Today lands on the current month; on the current month it is faded and not a link; the grid's today highlight still shows.

- [ ] **Step 5: Commit** — `feat: jump to the current month from the nav`

# Today button

**Date:** 2026-10-28
**Status:** approved, not yet implemented

## Why

Getting back to the current month after browsing means clicking → or ← once per
month. A **Today** button between the arrows jumps straight there.

## Whose clock

"Today" is the **browser's** local date, not the server's.

The server's default month comes from `currentMonthKey()`, which reads the
server clock. On Vercel that clock is UTC, eight hours behind the Philippines.
A plain `href="/"` would therefore send you to the previous month between
00:00 and 08:00 on the 1st, while the grid highlights a day in the new month.
The grid's highlight is already resolved client-side, so the button uses the
same source and the two always agree.

## Design

**`useToday()` in `src/lib/use-today.ts`.** The `useSyncExternalStore` read
currently inline in `calendar.tsx` moves here unchanged: a local
`YYYY-MM-DD` on the client, `null` in the server snapshot. Both `Calendar` and
the new link call it, so the highlight and the button share one definition of
today rather than two copies that could drift.

**`<TodayLink monthKey={monthKey} />` in `src/components/today-link.tsx`**, a
client component rendered in the `<nav>` of `page.tsx` between ← and →.

- Target month is `toMonthKey(today)`. `toMonthKey` already exists and is
  already tested for whole-day input, so there is no new pure logic.
- Before hydration (`today === null`) it links to `/`. This keeps the button
  working with no JavaScript, and it is correct except in the window above.
- After hydration it links to `/?m=<target>`.
- When `monthKey === target` it renders as a faded, non-interactive `<span>`
  (`aria-current="date"`) rather than a link, since there is nowhere to go.
- Styling matches the arrows: `border border-rule px-3 py-1.5 font-mono text-sm`,
  with `hover:bg-ink/5` on the link and `text-fade` on the inert state.
- Label: a `●` glyph, matching the text arrows, with `aria-label` and `title` "Current month" since the glyph carries no words.

`page.tsx` stays a server component; only the button is a client island.

## Testing

No new arithmetic, so no new unit test: the month derivation is `toMonthKey`,
already covered in `rto.test.ts`. Verified manually in the browser:

1. From another month, Today lands on the current month.
2. On the current month, Today is faded and not clickable.
3. The grid's today highlight still appears after the hook is extracted.

`make test` and `make lint` must pass.

## Out of scope

Keyboard shortcuts, and jumping to today's week or scrolling to the cell.

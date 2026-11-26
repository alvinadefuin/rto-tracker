# Mark palette

**Date:** 2026-11-26
**Status:** approved

## Why

Tapping a weekday cycles `null → office → leave → holiday → training → null`.
Reaching a status means remembering the order and tapping up to four times,
and clearing a day means going all the way round. Marking a run of office
days — the common case — costs a tap per day at best and more whenever a
day overshoots.

## What changes

A palette above the calendar replaces the cycle. Pick a mark once, then tap
days to apply it. Nothing below the tap changes: `setDayStatus`, the
optimistic update with revert-and-toast, `computeMonthStats`, the schema and
the arithmetic are untouched. No migration, no ADR.

## Design

**Five marks, one active at a time.**

| Mark     | Icon        | Colour token           | Writes       |
|----------|-------------|------------------------|--------------|
| Office   | building    | `stamp` `#be3b2e`      | `"office"`   |
| Leave    | tree        | `leave` → `#3e7a57`    | `"leave"`    |
| Holiday  | wine glass  | `holiday` → `#8a3a5c`  | `"holiday"`  |
| Training | book        | `training` `#8a6220`   | `"training"` |
| Erase    | eraser      | `fade` `#82877d`       | `null`       |

**Icons are hand-drawn inline SVG, never emoji** — emoji render differently on
every platform and ignore the palette. Each icon is two-tone: a 1.5px stroke
in its token and a fill of `color-mix(in srgb, <token> 18%, transparent)`, so
it reads as a small illustration rather than a line icon. If the fill muddies
at cell size, drop it in cells and keep it in the palette.

**Colours follow the icons.** A tree reads green, so `leave` takes the green
`holiday` had; `holiday` becomes a wine plum, `#8a3a5c` (6.75:1 on `paper`,
clearing the 4.5:1 text floor its siblings sit at 4.6–5.0). The old slate
`#5a6b8c` retires. Office stays stamp red — the colour of the day that
counts — and training stays ochre. Existing leave and holiday rows, imported
holidays included, change colour; the `@theme` comment records the swap.

`stats.tsx` used `holiday` as its "ahead" green (covered rings, "target
met"). Those move to a new `credit` token holding the same green, so a
verdict colour no longer moves with a status colour.
`fade` (3.36:1) is used only for the Erase button's icon, never as text, and
never appears in a cell.

The active palette button takes a solid border in its token and a tinted
background of the same mix; inactive buttons are `ink` on `paper`.

The active mark is `Mark = DayStatus | "erase"`, held as `Mark | null`.
Tapping the active palette button deselects it; tapping another switches to
it. Escape deselects.

**The tap rule** lives in `rto.ts` as `applyMark(current, mark)`, so it is
unit-tested in the `node` environment like the rest of the copy and
arithmetic:

| `mark`            | result                                   |
|-------------------|------------------------------------------|
| `null`            | `current` unchanged                      |
| `"erase"`         | `null`                                   |
| equals `current`  | `null` — tapping a mark again clears it  |
| any other status  | that status                              |

`Calendar` calls it on every tap. When the result equals `current`, it saves
nothing and sends no request. With no mark selected, the day does not change:
the palette pulses once and a toast reads "Pick a mark above first."

**Components.**

- `src/components/status-icons.tsx` — one inline SVG per mark, stroked in
  `currentColor` with the tinted fill above, `aria-hidden`. No icon
  dependency, no emoji.
- `src/components/mark-palette.tsx` — five buttons, icon plus label, each with
  `aria-pressed`. Stateless: takes `active`, `onSelect` and a `pulse` flag.
- `src/components/calendar-board.tsx` — new client wrapper. Owns the active
  mark, the Escape listener and the pulse, renders `<MarkPalette>` and then
  `<Calendar key={monthKey} …>`. `page.tsx` renders the board instead of the
  calendar and passes the same props through.

**Why the wrapper.** `<Calendar>` must keep `key={monthKey}`: it seeds its
state from `initialEntries` only on mount. That remount would also reset a
mark held inside it, so changing months would drop the selection. Holding
the mark one level up, outside the key, keeps it across months. The key
moves into the board; its comment in `page.tsx` moves with it.

**Cells.** A marked day shows its icon in the status colour instead of the
uppercase word. Office keeps the `stamp-ring` and the `stamp-in` animation,
with the building inside the ring. Mandated days keep `opacity-40
line-through` on the mark. `aria-label` keeps its current status wording and
ends with what a tap will now do, e.g. "Tap to mark office", "Tap to clear",
or "Pick a mark first", instead of "Tap to change".

**Help text.** The cycle sentence becomes: "Pick a mark, then tap days. Tap a
marked day again to clear it. Untouched days count as work from home." The
mandate sentence stays.

## Out of scope

- Drag-to-paint across days: it fights page scroll on touch screens. Tapping
  each day is enough for now.
- Remembering the mark across page loads.
- Keyboard shortcuts beyond Escape.

## Testing

- Vitest: `applyMark` across every `current` (`null` plus the four statuses)
  × every `mark` (`null`, `"erase"`, the four statuses).
- Browser check: pick Office and tap several days; tap one again to clear it;
  switch to Leave and overwrite an office day; Erase a day; tap with no mark
  and see the pulse and toast with nothing saved; change month and confirm
  the mark is still active; press Escape to deselect; confirm a stamp on a
  mandated day still renders faded; check each icon at cell size on a phone
  width and in the palette.

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

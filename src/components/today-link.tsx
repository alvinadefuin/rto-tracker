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
      <span
        aria-current="date"
        aria-label="Current month"
        title="Current month"
        className={`${BOX} text-fade`}
      >
        ●
      </span>
    );
  }

  return (
    <Link
      href={target ? `/?m=${target}` : "/"}
      aria-label="Current month"
      title="Current month"
      className={`${BOX} hover:bg-ink/5`}
    >
      ●
    </Link>
  );
}

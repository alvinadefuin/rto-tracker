"use client";

import { useRef, useState } from "react";
import { setDayStatus } from "@/app/actions";
import {
  computeFyStats,
  computeMonthStats,
  isEligible,
  isMandated,
  isWeekend,
  type DayStatus,
  type Entries,
  type FyBaseline,
  type WfhMandate,
} from "@/lib/rto";
import { Stats } from "@/components/stats";
import { Toast } from "@/components/toast";
import { useToday } from "@/lib/use-today";

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

const pad = (n: number) => String(n).padStart(2, "0");

// Monday-first month grid; null cells pad the edges.
function monthGrid(year: number, month: number): (string | null)[][] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (string | null)[] = Array((firstDow + 6) % 7).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${pad(month)}-${pad(d)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Every non-office status needs a colour; a ternary here would quietly paint a
// new status in the last branch's colour.
const STATUS_CLASS: Record<Exclude<DayStatus, "office">, string> = {
  leave: "text-leave",
  holiday: "text-holiday",
  training: "text-training",
};

function DayMark({
  status,
  stamped,
  muted = false,
}: {
  status: DayStatus;
  stamped: boolean;
  muted?: boolean;
}) {
  const mutedClass = muted ? "opacity-40 line-through" : "";
  if (status === "office") {
    return (
      <span
        className={`stamp-ring px-2 py-0.5 font-mono text-[10px] font-semibold tracking-widest uppercase ${
          stamped ? "stamp-in" : ""
        } ${mutedClass}`}
      >
        Office
      </span>
    );
  }
  return (
    <span
      className={`font-mono text-[10px] font-medium tracking-widest uppercase ${
        STATUS_CLASS[status]
      } ${mutedClass}`}
    >
      {status}
    </span>
  );
}

// The displayed month arrives once, as a key: year and month are derived below
// rather than passed alongside it, so there is nothing here that can disagree.
export function Calendar({
  monthKey,
  initialEntries,
  holidays,
  targetPercent,
  mandates,
  fyBaseline,
}: {
  monthKey: string;
  initialEntries: Entries;
  /**
   * The PH holiday calendar for this month, weekend holidays included. A list
   * rather than a richer `Entries`: that type is `Record<string, DayStatus>`
   * throughout `rto.ts` and every arithmetic function takes it, so widening it
   * would touch all of them to carry data none of them read.
   */
  holidays: { date: string; name: string }[];
  targetPercent: number;
  mandates: WfhMandate[];
  fyBaseline: FyBaseline | null;
}) {
  const [entries, setEntries] = useState<Entries>(initialEntries);
  const [toast, setToast] = useState<string | null>(null);
  // Last cell the user stamped — only that one animates
  const [justStamped, setJustStamped] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server renders no "today" highlight; the client fills it in on hydration.
  const today = useToday();

  const [year, month] = monthKey.split("-").map(Number);
  const stats = computeMonthStats(year, month, entries, targetPercent, mandates);
  // Recomputed on every tap from the same fixed prior window: the months before
  // this one are not editable from here, so the only moving part is `entries`.
  const fyStats = fyBaseline
    ? computeFyStats(monthKey, fyBaseline, stats)
    : null;
  const weeks = monthGrid(year, month);

  // Every holiday the month has, annotated only where the day is *still
  // eligible* — that is, where the listed holiday is not actually excluding it.
  // The statuses that exclude a day are ELIGIBLE_BY_STATUS's business, not this
  // list's: whatever they are, such a day needs no annotation, because it is
  // already out of the pool and saying "you marked leave" would imply it counts.
  // Computed from live `entries`, so a tap updates the annotation on the same tap.
  const monthHolidays = [...holidays]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, name }) => {
      if (isWeekend(date)) {
        const [y, m, d] = date.split("-").map(Number);
        const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        return { date, name, note: day === 6 ? "(Sat)" : "(Sun)" };
      }
      if (!isEligible(date, entries, mandates)) return { date, name, note: null };
      return {
        date,
        name,
        note:
          entries[date] === "office" ? "(you marked office)" : "(not marked)",
      };
    });

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  function cycle(date: string) {
    const current = entries[date] ?? null;
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];

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

  // Weekend columns disappear on narrow screens — they hold no actions
  const gridCols =
    "grid grid-cols-[repeat(5,minmax(0,1fr))_2.75rem] sm:grid-cols-[repeat(5,minmax(0,1fr))_0.4fr_0.4fr_2.75rem]";

  return (
    <div className="space-y-6">
      <Stats stats={stats} fyStats={fyStats} />

      <div className="border border-rule bg-white/40">
        <div className={`${gridCols} border-b border-rule`}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
            <div
              key={d}
              className={`px-2 py-1.5 font-mono text-[10px] tracking-widest text-fade uppercase ${
                i >= 5 ? "hidden sm:block" : ""
              }`}
            >
              {d}
            </div>
          ))}
          <div className="border-l border-rule px-2 py-1.5 text-right font-mono text-[10px] tracking-widest text-fade uppercase">
            wk
          </div>
        </div>

        {weeks.map((week, wi) => {
          const weekdays = week.filter(
            (d): d is string => d !== null && !isWeekend(d)
          );
          const eligible = weekdays.filter((d) =>
            isEligible(d, entries, mandates)
          ).length;
          const office = weekdays.filter(
            (d) => isEligible(d, entries, mandates) && entries[d] === "office"
          ).length;
          // The label announces the condition once per row, not the run's bounds
          const firstMandated = weekdays.find((d) => isMandated(d, mandates));

          return (
            <div
              key={wi}
              className={`${gridCols} ${wi > 0 ? "border-t border-rule" : ""}`}
            >
              {week.map((date, di) => {
                const weekendCol = di >= 5;
                if (date === null) {
                  return (
                    <div
                      key={di}
                      className={`min-h-16 ${di > 0 ? "border-l border-rule" : ""} ${
                        weekendCol ? "hidden sm:block" : ""
                      }`}
                    />
                  );
                }
                const day = Number(date.slice(-2));
                if (isWeekend(date)) {
                  return (
                    <div
                      key={di}
                      className="hidden min-h-16 border-l border-rule bg-ink/4 p-1.5 sm:block"
                    >
                      <span className="font-mono text-xs text-fade/70">
                        {day}
                      </span>
                    </div>
                  );
                }
                const status = entries[date] ?? null;
                const mandated = isMandated(date, mandates);
                return (
                  <button
                    key={di}
                    type="button"
                    onClick={() => cycle(date)}
                    aria-label={
                      mandated
                        ? `${date}: Mandated work from home${
                            status
                              ? `, ${STATUS_LABEL[status]} recorded but not counted`
                              : ""
                          }. Tap to change.`
                        : `${date}: ${STATUS_LABEL[status ?? "wfh"]}. Tap to change.`
                    }
                    className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 p-1.5 transition-colors hover:bg-ink/5 ${
                      di > 0 ? "border-l border-rule" : ""
                    } ${mandated ? "mandate-hatch" : ""}`}
                  >
                    <span
                      className={`absolute top-1.5 left-1.5 font-mono text-xs ${
                        mandated ? "text-fade" : ""
                      } ${
                        date === today
                          ? "-mx-1 -my-0.5 bg-ink px-1 py-0.5 font-semibold text-paper"
                          : ""
                      }`}
                    >
                      {day}
                    </span>
                    {mandated && date === firstMandated && (
                      <span className="bg-paper px-1 font-mono text-[10px] tracking-widest text-fade lowercase">
                        mandated
                      </span>
                    )}
                    {status && (
                      <DayMark
                        status={status}
                        // stamp-in ends on opacity:1 with fill-mode both, and
                        // animation values outrank the opacity-40 utility — so
                        // animating a muted stamp would un-mute it until the
                        // next tap anywhere clears justStamped.
                        stamped={justStamped === date && !mandated}
                        muted={mandated}
                      />
                    )}
                  </button>
                );
              })}
              <div className="flex min-h-16 items-center justify-end border-l border-rule px-2">
                <span className="font-mono text-xs text-fade">
                  {office}/{eligible}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {monthHolidays.length > 0 && (
        <div className="space-y-1 border-l-2 border-fade pl-3">
          <p className="font-mono text-[10px] tracking-widest text-fade uppercase">
            Holidays
          </p>
          {monthHolidays.map(({ date, name, note }) => (
            <p key={date} className="font-mono text-xs text-fade">
              <span className="mr-2 inline-block w-4 text-right tabular-nums">
                {Number(date.slice(-2))}
              </span>
              {name}
              {note && <span className="ml-2 text-fade/70">{note}</span>}
            </p>
          ))}
        </div>
      )}

      <p className="text-xs text-fade">
        Tap a weekday to cycle: work from home → office → leave → holiday →
        training. Untouched days count as work from home. Hatched days are
        mandated work from home — they don&apos;t count toward the requirement.
      </p>

      {toast && <Toast message={toast} />}
    </div>
  );
}

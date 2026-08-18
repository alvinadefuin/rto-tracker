"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { setDayStatus } from "@/app/actions";
import {
  computeMonthStats,
  isEligible,
  isMandated,
  isWeekend,
  type DayStatus,
  type Entries,
  type WfhMandate,
} from "@/lib/rto";
import { Stats } from "@/components/stats";
import { Toast } from "@/components/toast";

const CYCLE: (DayStatus | null)[] = [null, "office", "leave", "holiday"];

const STATUS_LABEL: Record<DayStatus | "wfh", string> = {
  wfh: "Work from home",
  office: "Office",
  leave: "Leave",
  holiday: "Holiday",
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
        status === "leave" ? "text-leave" : "text-holiday"
      } ${mutedClass}`}
    >
      {status}
    </span>
  );
}

export function Calendar({
  year,
  month,
  initialEntries,
  targetPercent,
  mandates,
}: {
  year: number;
  month: number;
  initialEntries: Entries;
  targetPercent: number;
  mandates: WfhMandate[];
}) {
  const [entries, setEntries] = useState<Entries>(initialEntries);
  const [toast, setToast] = useState<string | null>(null);
  // Last cell the user stamped — only that one animates
  const [justStamped, setJustStamped] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server renders no "today" highlight; the client fills it in on hydration.
  const today = useSyncExternalStore(
    () => () => {},
    () => {
      const now = new Date();
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    },
    () => null
  );

  const stats = computeMonthStats(year, month, entries, targetPercent, mandates);
  const weeks = monthGrid(year, month);

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
      <Stats stats={stats} />

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
                      <span className="font-mono text-[10px] tracking-widest text-fade lowercase">
                        mandated
                      </span>
                    )}
                    {status && (
                      <DayMark
                        status={status}
                        stamped={justStamped === date}
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

      <p className="text-xs text-fade">
        Tap a weekday to cycle: work from home → office → leave → holiday.
        Untouched days count as work from home. Hatched days are mandated work
        from home — they don&apos;t count toward the requirement.
      </p>

      {toast && <Toast message={toast} />}
    </div>
  );
}

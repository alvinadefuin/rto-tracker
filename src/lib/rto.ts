export type DayStatus = "office" | "leave" | "holiday";
export type Entries = Record<string, DayStatus>; // key: 'YYYY-MM-DD'

export interface WeekStats {
  start: string; // first weekday of the chunk (YYYY-MM-DD)
  end: string; // last weekday of the chunk
  eligibleDays: number;
  officeDays: number;
}

export interface MonthStats {
  eligibleDays: number; // weekdays − holidays − leaves
  officeDays: number;
  requiredDays: number; // ceil(0.4 * eligibleDays)
  remainingNeeded: number; // max(0, requiredDays − officeDays)
  percent: number; // officeDays / eligibleDays (0 when eligibleDays === 0)
  weeks: WeekStats[]; // Mon–Fri chunks; partial at month edges
}

export const RTO_TARGET = 0.4;

const pad = (n: number) => String(n).padStart(2, "0");

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

// 0 = Sunday … 6 = Saturday. UTC math only — never parse date strings
// through the local timezone.
function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

export function monthWeekdays(year: number, month: number): string[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const result: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = toDateString(year, month, day);
    if (!isWeekend(date)) result.push(date);
  }
  return result;
}

export function computeMonthStats(
  year: number,
  month: number,
  entries: Entries
): MonthStats {
  const weekdays = monthWeekdays(year, month);

  let eligibleDays = 0;
  let officeDays = 0;
  const weeks: WeekStats[] = [];
  let current: WeekStats | null = null;

  for (const date of weekdays) {
    // A new Mon–Fri chunk starts on Monday or at the month's first weekday
    if (current === null || dayOfWeek(date) === 1) {
      current = { start: date, end: date, eligibleDays: 0, officeDays: 0 };
      weeks.push(current);
    }
    current.end = date;

    const status = entries[date];
    if (status === "leave" || status === "holiday") continue;
    eligibleDays++;
    current.eligibleDays++;
    if (status === "office") {
      officeDays++;
      current.officeDays++;
    }
  }

  const requiredDays = Math.ceil(RTO_TARGET * eligibleDays);
  return {
    eligibleDays,
    officeDays,
    requiredDays,
    remainingNeeded: Math.max(0, requiredDays - officeDays),
    percent: eligibleDays === 0 ? 0 : officeDays / eligibleDays,
    weeks,
  };
}

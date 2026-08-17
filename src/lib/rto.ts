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
  requiredDays: number; // ceil(eligibleDays * targetPercent / 100)
  remainingNeeded: number; // max(0, requiredDays − officeDays)
  targetPercent: number; // whole percent required this month, e.g. 20
  achievedPercent: number; // whole percent achieved, 0 when eligibleDays === 0
  weeks: WeekStats[]; // Mon–Fri chunks; partial at month edges
}

/** Whole percent required when no configured period covers a month. */
export const DEFAULT_RTO_PERCENT = 40;

/**
 * Stand-in for "no end month". Same fixed width as a real YYYY-MM key, so
 * comparisons stay pure string compares and no Date is ever constructed.
 */
const OPEN_ENDED = "9999-12";

export interface TargetPeriod {
  startMonth: string; // YYYY-MM, inclusive
  endMonth: string | null; // YYYY-MM inclusive, or null when ongoing
  percent: number; // whole percent, 0..100
}

/** Whole percent in effect for `monthKey` (YYYY-MM). */
export function resolvePercent(
  monthKey: string,
  periods: TargetPeriod[]
): number {
  const hit = [...periods]
    .sort((a, b) => a.startMonth.localeCompare(b.startMonth))
    .find(
      (p) => monthKey >= p.startMonth && monthKey <= (p.endMonth ?? OPEN_ENDED)
    );
  return hit ? hit.percent : DEFAULT_RTO_PERCENT;
}

/** True when two periods share at least one month. */
export function periodsOverlap(a: TargetPeriod, b: TargetPeriod): boolean {
  return (
    a.startMonth <= (b.endMonth ?? OPEN_ENDED) &&
    b.startMonth <= (a.endMonth ?? OPEN_ENDED)
  );
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Months a closed period covers, inclusive. `null` when the period is ongoing —
 * returning null rather than a number forces callers to handle the unbounded
 * case instead of quietly rendering a wrong count.
 */
export function countMonthsInPeriod(period: TargetPeriod): number | null {
  if (period.endMonth === null) return null;
  const [sy, sm] = period.startMonth.split("-").map(Number);
  const [ey, em] = period.endMonth.split("-").map(Number);
  return ey * 12 + em - (sy * 12 + sm) + 1;
}

/** "2022-06" → "Jun 2022". */
export function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTH_ABBR[month - 1]} ${year}`;
}

/** "Jun 2022 – Dec 2023", or "Jun 2022 – ongoing" when open-ended. */
export function formatPeriodRange(period: TargetPeriod): string {
  const end =
    period.endMonth === null ? "ongoing" : formatMonth(period.endMonth);
  return `${formatMonth(period.startMonth)} – ${end}`;
}

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
  entries: Entries,
  targetPercent: number = DEFAULT_RTO_PERCENT
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

  const requiredDays = Math.ceil((eligibleDays * targetPercent) / 100);
  return {
    eligibleDays,
    officeDays,
    requiredDays,
    remainingNeeded: Math.max(0, requiredDays - officeDays),
    targetPercent,
    achievedPercent:
      eligibleDays === 0 ? 0 : Math.round((officeDays / eligibleDays) * 100),
    weeks,
  };
}

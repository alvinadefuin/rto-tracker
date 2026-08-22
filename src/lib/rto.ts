export type DayStatus = "office" | "leave" | "holiday";
export type Entries = Record<string, DayStatus>; // key: 'YYYY-MM-DD'

export interface WeekStats {
  start: string; // first weekday of the chunk (YYYY-MM-DD)
  end: string; // last weekday of the chunk
  eligibleDays: number;
  officeDays: number;
}

export interface MonthStats {
  eligibleDays: number; // weekdays − mandated − holidays − leaves
  officeDays: number;
  requiredDays: number; // ceil(eligibleDays * targetPercent / 100)
  remainingNeeded: number; // max(0, requiredDays − officeDays)
  targetPercent: number; // whole percent required this month, e.g. 20
  achievedPercent: number; // whole percent achieved, 0 when eligibleDays === 0
  mandatedDays: number; // mandated weekdays in the month, excluded from eligible
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

export interface WfhMandate {
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string | null; // YYYY-MM-DD inclusive, or null = until further notice
  reason?: string | null; // display only; every helper here ignores it
}

/**
 * Stand-in for "no end date". Same fixed width as a real YYYY-MM-DD key, so
 * comparisons stay pure string compares and no Date is ever constructed.
 * Day-granularity sibling of OPEN_ENDED above.
 */
const OPEN_ENDED_DATE = "9999-12-31";

/** True when `date` falls inside any mandate. */
export function isMandated(date: string, mandates: WfhMandate[]): boolean {
  return mandates.some(
    (m) => date >= m.startDate && date <= (m.endDate ?? OPEN_ENDED_DATE)
  );
}

/** True when two mandates share at least one day. */
export function mandatesOverlap(a: WfhMandate, b: WfhMandate): boolean {
  return (
    a.startDate <= (b.endDate ?? OPEN_ENDED_DATE) &&
    b.startDate <= (a.endDate ?? OPEN_ENDED_DATE)
  );
}

/**
 * Inclusive day-by-day walk from `start` to `end`. UTC component math only:
 * the Date is built from split integers, never parsed from the string.
 */
function* eachDate(start: string, end: string): Generator<string> {
  const [y, m, d] = start.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  for (;;) {
    const date = toDateString(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      cursor.getUTCDate()
    );
    if (date > end) return;
    yield date;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

/**
 * Weekdays a closed mandate covers, inclusive. `null` when open-ended —
 * returning null rather than a number forces callers to handle the unbounded
 * case instead of quietly rendering a wrong count.
 *
 * Walks the range rather than using a closed-form weekday formula: the longest
 * realistic span is a few thousand iterations, evaluated once per delete-dialog
 * render, and the walk is obviously correct where the formula is not.
 */
export function countWeekdaysInMandate(mandate: WfhMandate): number | null {
  if (mandate.endDate === null) return null;
  let count = 0;
  for (const date of eachDate(mandate.startDate, mandate.endDate)) {
    if (!isWeekend(date)) count++;
  }
  return count;
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

/** "2026-08-12" → "12 Aug 2026". */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTH_ABBR[month - 1]} ${year}`;
}

/** "12 Aug 2026 – 20 Aug 2026", or "12 Aug 2026 – until further notice". */
export function formatMandateRange(mandate: WfhMandate): string {
  const end =
    mandate.endDate === null
      ? "until further notice"
      : formatDate(mandate.endDate);
  return `${formatDate(mandate.startDate)} – ${end}`;
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * True when `value` is a real calendar day in YYYY-MM-DD form. The regex alone
 * admits 2026-02-30, so the components are round-tripped through Date.UTC and
 * compared back — still UTC-only math, never a parse of the string itself.
 */
export function isValidDateKey(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Month key for either a `YYYY-MM` key or a `YYYY-MM-DD` day, or null when the
 * value is neither. Accepting both is what lets the settings form post whole
 * dates from a date picker while `rto_targets` keeps storing months.
 *
 * This is now the only month-key validator in the codebase: `page.tsx` and
 * `settings-actions.ts` each had their own copy of the regex above.
 */
export function toMonthKey(value: string): string | null {
  if (MONTH_KEY_RE.test(value)) return value;
  if (isValidDateKey(value)) return value.slice(0, 7);
  return null;
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

/**
 * True when a **weekday** counts toward the requirement. Callers filter
 * weekends first. A mandate wins over any recorded status — the exclusion is a
 * property of the mandate, not of what the user tapped.
 *
 * This is the single definition of the eligible-day rule; computeMonthStats and
 * the calendar's per-week badge both defer to it.
 */
export function isEligible(
  date: string,
  entries: Entries,
  mandates: WfhMandate[]
): boolean {
  if (isMandated(date, mandates)) return false;
  const status = entries[date];
  return status !== "leave" && status !== "holiday";
}

export function computeMonthStats(
  year: number,
  month: number,
  entries: Entries,
  targetPercent: number = DEFAULT_RTO_PERCENT,
  mandates: WfhMandate[] = []
): MonthStats {
  const weekdays = monthWeekdays(year, month);

  // Counted in its own pass, deliberately: a mandated day that is also marked
  // leave is one mandated day, not one of each. Keeping this out of the loop
  // below means the two facts are order-independent, so there is no "which
  // check runs first" invariant left for a later edit to break.
  const mandatedDays = weekdays.filter((d) => isMandated(d, mandates)).length;

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

    if (!isEligible(date, entries, mandates)) continue;

    eligibleDays++;
    current.eligibleDays++;
    if (entries[date] === "office") {
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
    mandatedDays,
    weeks,
  };
}

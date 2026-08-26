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
  /**
   * eligibleDays × targetPercent, in integer percent-points and deliberately
   * un-rounded. Authoritative: every comparison and every rendered string
   * derives from this, not from the fractional sibling below.
   */
  requiredPoints: number;
  requiredDays: number; // requiredPoints / 100 — the readable figure, e.g. 5.2
  /** max(0, requiredPoints − officeDays × 100). Exact; 0 means the month is met. */
  remainingPoints: number;
  remainingNeeded: number; // remainingPoints / 100
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

// Defined here rather than beside the other string helpers below: the month-key
// builders above are its first callers, and define-before-use keeps the file
// readable top to bottom.
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Financial years start in August. Hardcoded rather than configurable: one
 * employer, one calendar. The maths below assumes a start month after January,
 * which August is.
 */
const FY_START_MONTH = 8;

/**
 * Financial year containing `monthKey`, named for the calendar year it **ends**
 * in — FY2027 runs Aug 2026 through Jul 2027.
 *
 * Takes a month key rather than reading the clock, deliberately: every caller
 * derives the year from the month on screen, which is what keeps server output
 * timezone-independent.
 */
export function financialYearOf(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return month >= FY_START_MONTH ? year + 1 : year;
}

/** First and last month of `fy`, inclusive. */
export function financialYearBounds(fy: number): {
  startMonth: string;
  endMonth: string;
} {
  return {
    startMonth: `${fy - 1}-${pad(FY_START_MONTH)}`,
    endMonth: `${fy}-${pad(FY_START_MONTH - 1)}`,
  };
}

/**
 * `monthKey` shifted by `delta` months. Integer month math on a year*12 index —
 * no Date is constructed, so no timezone can intervene.
 */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/**
 * Inclusive `YYYY-MM` walk from `start` to `end`; `[]` when `start > end`.
 * The bound is a string comparison, which is exact for fixed-width keys.
 */
export function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  for (let key = start; key <= end; key = shiftMonthKey(key, 1)) {
    months.push(key);
  }
  return months;
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
 * True when `mandate` covers any day of `monthKey` (YYYY-MM). The `-31` upper
 * bound is the same trick the page queries use: against a fixed-width key, a
 * bound past the end of a short month is harmless, because no stored day can
 * fall between the real month end and the 31st.
 */
export function mandateTouchesMonth(
  mandate: WfhMandate,
  monthKey: string
): boolean {
  return (
    mandate.startDate <= `${monthKey}-31` &&
    `${monthKey}-01` <= (mandate.endDate ?? OPEN_ENDED_DATE)
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

/**
 * Percent-points as a readable day count: 520 → "5.2", 800 → "8", 429 → "4.29".
 *
 * Takes points rather than a fractional day deliberately. `targetPercent` and
 * `eligibleDays` are both whole, so points/100 is exact to two decimals — no
 * float is ever formatted, the one division is truncated on the spot, and no
 * rounding decision is hidden in here.
 *
 * `points` is a non-negative integer: both factors are whole, and shortfalls are
 * clamped at zero before they reach here. Negative or fractional input produces
 * a malformed string rather than throwing.
 */
export function formatDays(points: number): string {
  const whole = Math.trunc(points / 100);
  const frac = points % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
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
 */
export function toMonthKey(value: string): string | null {
  if (MONTH_KEY_RE.test(value)) return value;
  if (isValidDateKey(value)) return value.slice(0, 7);
  return null;
}

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

  // Percent-points, un-rounded: the employer computes 13 × 40% as 5.2 days, not
  // 6. The financial year is where the fraction is finally settled, with a
  // single Math.ceil in computeFyStats — never one per month.
  const requiredPoints = eligibleDays * targetPercent;
  const remainingPoints = Math.max(0, requiredPoints - officeDays * 100);
  return {
    eligibleDays,
    officeDays,
    requiredPoints,
    requiredDays: requiredPoints / 100,
    remainingPoints,
    remainingNeeded: remainingPoints / 100,
    targetPercent,
    achievedPercent:
      eligibleDays === 0 ? 0 : Math.round((officeDays / eligibleDays) * 100),
    mandatedDays,
    weeks,
  };
}

export interface MonthsAggregate {
  officeDays: number;
  /**
   * Σ (eligibleDays × targetPercent) across the months, in percent-points and
   * deliberately **un-rounded**. Dividing by 100 exactly once, at the end, in
   * computeFyStats is the whole point: it is what makes a 260-weekday year at
   * 40% owe 104 days rather than the ~110 that twelve monthly round-ups cost.
   */
  weightedEligible: number;
}

/**
 * Roll up whole months. Each month resolves its own percentage, so a rate
 * change part-way through the window is honoured.
 *
 * Goes through computeMonthStats even though the weeks array it builds is
 * thrown away: eleven months of throwaway arrays once per render is nothing,
 * and it keeps exactly one definition of an eligible day. A second, leaner
 * counting path is how the two drift apart.
 */
export function aggregateMonths(
  months: string[],
  entries: Entries,
  periods: TargetPeriod[],
  mandates: WfhMandate[]
): MonthsAggregate {
  let officeDays = 0;
  let weightedEligible = 0;
  for (const monthKey of months) {
    const [year, month] = monthKey.split("-").map(Number);
    const percent = resolvePercent(monthKey, periods);
    const stats = computeMonthStats(year, month, entries, percent, mandates);
    officeDays += stats.officeDays;
    weightedEligible += stats.eligibleDays * percent;
  }
  return { officeDays, weightedEligible };
}

/**
 * First month to count for `monthKey`'s FY, or null when there is no record to
 * carry.
 *
 * `null` when nothing was ever recorded, and when the record starts after the
 * displayed month — in which case there is no history to carry and the
 * displayed month is empty too, `trackingStart` being the earliest row there
 * is. Otherwise the later of the two: browsing an FY that predates the app must
 * not report a hundred-day deficit for months that were never recorded.
 *
 * Pure fixed-width string comparison, so it lives here rather than in the page:
 * it is the subtlest rule in the feature and the only one a page could hide.
 */
export function fyWindowStart(
  monthKey: string,
  fyStartMonth: string,
  trackingStart: string | null
): string | null {
  if (trackingStart === null || trackingStart > monthKey) return null;
  return trackingStart > fyStartMonth ? trackingStart : fyStartMonth;
}

/**
 * What the months before the displayed one contribute. Only the two facts a
 * caller cannot derive: everything else about the year follows from the month
 * key, and holding derived copies here is how a baseline whose FY bounds
 * disagree with its month gets built.
 */
export interface FyBaseline {
  /**
   * First month counted for this FY — the FY's own start, or later when the
   * record began mid-year.
   */
  windowStartMonth: string;
  /** Months from windowStartMonth up to, but not including, the displayed month. */
  prior: MonthsAggregate;
}

export interface FyStats {
  fy: number;
  fyStartMonth: string;
  fyEndMonth: string;
  windowStartMonth: string;
  isPartialWindow: boolean; // windowStartMonth > fyStartMonth
  isFinalMonth: boolean; // monthKey === fyEndMonth
  cumulativeOffice: number;
  cumulativeRequired: number;
  balance: number; // office − required; negative means days are owed
  remainingNeeded: number; // max(0, −balance)
}

/**
 * Financial-year position through `monthKey`, inclusive.
 *
 * The year and its bounds are derived here from `monthKey` rather than taken
 * from the caller: they are a function of it, and a caller that passed both
 * could pass a July with another year's bounds and get isFinalMonth: false.
 *
 * The single Math.ceil here is the design: prior months contribute un-rounded
 * percent-points, the displayed month adds its own, and the year rounds up once.
 * Every field is derived from month keys and integers, so nothing consults the
 * clock and the client can recompute this after each tap.
 */
export function computeFyStats(
  monthKey: string,
  baseline: FyBaseline,
  monthStats: MonthStats
): FyStats {
  const fy = financialYearOf(monthKey);
  const { startMonth: fyStartMonth, endMonth: fyEndMonth } =
    financialYearBounds(fy);

  const cumulativeOffice = baseline.prior.officeDays + monthStats.officeDays;
  const weighted =
    baseline.prior.weightedEligible +
    monthStats.eligibleDays * monthStats.targetPercent;
  const cumulativeRequired = Math.ceil(weighted / 100);
  const balance = cumulativeOffice - cumulativeRequired;
  return {
    fy,
    fyStartMonth,
    fyEndMonth,
    windowStartMonth: baseline.windowStartMonth,
    isPartialWindow: baseline.windowStartMonth > fyStartMonth,
    isFinalMonth: monthKey === fyEndMonth,
    cumulativeOffice,
    cumulativeRequired,
    balance,
    remainingNeeded: Math.max(0, -balance),
  };
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The one sentence saying what the financial year still owes.
 *
 * Takes the whole `MonthStats` rather than its `remainingNeeded` number: the
 * month's shortfall and the year's are different quantities, and passing
 * `fy.remainingNeeded` by mistake would type-check while producing a plausible
 * wrong sentence. `FyStats` is not assignable to `MonthStats`, so it cannot.
 *
 * Copy lives here rather than in the component because Vitest runs without a
 * DOM: eight branches are worth asserting, and in JSX they could not be.
 */
export function fyVerdict(fy: FyStats, monthStats: MonthStats): string {
  // Only the branches that name the year carry this: "FY2027 fully covered"
  // from two months of data is a false claim, and the block's header line is
  // not the claim — this sentence is.
  const windowNote = fy.isPartialWindow
    ? ` (counted from ${formatMonth(fy.windowStartMonth)})`
    : "";

  if (fy.balance > 0) {
    const ahead = `${plural(fy.balance, "day", "days")} ahead`;
    // `isFinalMonth` is a month comparison — monthKey === fyEndMonth — not a
    // statement about time. Nothing here reads a clock, so eleven presses of
    // the next-month arrow land in this branch for a July that has not
    // happened. What is true either way is that the window now spans all
    // twelve months, so the figures are the full year's rather than a
    // year-to-date slice. Never word these three as if the year had ended.
    if (fy.isFinalMonth)
      return `${ahead} — FY${fy.fy} fully covered${windowNote}.`;
    // The claim holds because cumulativeRequired already includes the displayed
    // month's whole requirement: a non-negative balance means the month's
    // remaining days are paid for. Do not "fix" the apparent contradiction of
    // "1 day ahead" next to "9 remaining days are covered".
    if (monthStats.remainingNeeded > 0) {
      const remaining = plural(
        monthStats.remainingNeeded,
        "remaining day is",
        "remaining days are"
      );
      return `${ahead} — this month's ${remaining} covered.`;
    }
    return `${ahead} — banked toward later months.`;
  }

  // After the surplus branch, deliberately: a 0% target period or a month of
  // leave reaches a zero requirement with days still banked, and the surplus is
  // then the news. Reachable only with balance === 0, since balance equals
  // cumulativeOffice when nothing is required — so no branch below is shadowed.
  // Worded without naming a cause OR an eligibility count: a mandate, a month of
  // leave, and a 0% period all land here, and the last one has eligible days that
  // were counted and then weighted to zero.
  if (fy.cumulativeRequired === 0) {
    return "No requirement — the year owes nothing.";
  }

  if (fy.balance === 0) {
    return fy.isFinalMonth
      ? `Level — FY${fy.fy} covered exactly${windowNote}.`
      : "Level — no days banked.";
  }

  const owed = -fy.balance;
  return fy.isFinalMonth
    ? `${plural(owed, "office day", "office days")} short of FY${fy.fy}'s full year${windowNote}.`
    : `${plural(owed, "more office day", "more office days")} needed to be level.`;
}

/**
 * Today's month, in the **server's** local timezone.
 *
 * The app's only clock read, isolated so its caveat has a single home: it makes
 * the caller's default month — and any financial year derived from it —
 * server-timezone-dependent, and near 31 Jul / 1 Aug that month boundary is
 * also a financial-year boundary. Everything downstream of the chosen month is
 * pure month-key arithmetic; see `financialYearOf`, which takes a month key
 * precisely so it never reads a clock.
 *
 * Not in `rto.ts`: that module is pure and isomorphic, and must not read a
 * clock. Today's date on the calendar grid is resolved client-side instead, so
 * SSR output stays timezone-independent.
 */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

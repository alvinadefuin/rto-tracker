import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, isNull, lte, min, or } from "drizzle-orm";
import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { dayEntries, phHolidays, rtoTargets, wfhMandates } from "@/db/schema";
import {
  aggregateMonths,
  financialYearBounds,
  financialYearOf,
  formatDate,
  fyWindowStart,
  mandateTouchesMonth,
  monthsBetween,
  resolvePercent,
  shiftMonthKey,
  toMonthKey,
  type Entries,
  type FyBaseline,
} from "@/lib/rto";
import { currentMonthKey } from "@/lib/clock";
import { Calendar } from "@/components/calendar";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const { m } = await searchParams;
  const monthKey = (m ? toMonthKey(m) : null) ?? currentMonthKey();
  const [year, month] = monthKey.split("-").map(Number);

  // The FY on screen follows the month on screen, never the clock — that is
  // what keeps this render timezone-independent, and it is what lets you review
  // a finished year. With no ?m= the month itself comes from the server clock,
  // so a default render near a month boundary can land on the previous FY, not
  // merely the previous month.
  const { startMonth: fyStartMonth } = financialYearBounds(
    financialYearOf(monthKey)
  );

  // Two waves rather than four sequential awaits: neon-http opens one HTTPS
  // request per query with no pipelining, so every one is a full round trip.
  // The split falls at queryStart — these two facts about the user depend on
  // nothing, the two rowsets below depend on the window they decide.
  const [[firstRow], periodRows] = await Promise.all([
    // Month the record begins. An aggregate, so one row back and no entries.
    db
      .select({ first: min(dayEntries.date) })
      .from(dayEntries)
      .where(eq(dayEntries.userId, session.user.id)),
    db
      .select({
        startMonth: rtoTargets.startMonth,
        endMonth: rtoTargets.endMonth,
        percent: rtoTargets.percent,
      })
      .from(rtoTargets)
      .where(eq(rtoTargets.userId, session.user.id)),
  ]);

  const trackingStart = firstRow?.first ? firstRow.first.slice(0, 7) : null;
  const windowStart = fyWindowStart(monthKey, fyStartMonth, trackingStart);
  const queryStart = windowStart ?? monthKey;

  const [rows, mandates, monthHolidays] = await Promise.all([
    db
      .select({
        date: dayEntries.date,
        status: dayEntries.status,
        note: dayEntries.note,
      })
      .from(dayEntries)
      .where(
        and(
          eq(dayEntries.userId, session.user.id),
          gte(dayEntries.date, `${queryStart}-01`),
          lte(dayEntries.date, `${monthKey}-31`)
        )
      ),
    // Mandates touching the FY window, not just this month: the aggregate needs
    // the earlier months too. The -31 upper bound is the same string comparison
    // trick the day_entries query uses — a bound past the end of a short month
    // is harmless against a fixed-width key.
    db
      .select({
        id: wfhMandates.id,
        startDate: wfhMandates.startDate,
        endDate: wfhMandates.endDate,
        reason: wfhMandates.reason,
      })
      .from(wfhMandates)
      .where(
        and(
          eq(wfhMandates.userId, session.user.id),
          lte(wfhMandates.startDate, `${monthKey}-31`),
          or(
            isNull(wfhMandates.endDate),
            gte(wfhMandates.endDate, `${queryStart}-01`)
          )
        )
      ),
    // The displayed month only. This is the PH calendar, not the user's record:
    // it holds weekend holidays, is not user-scoped, and nothing computed reads
    // it — the footnote is its only consumer.
    db
      .select({ date: phHolidays.date, name: phHolidays.name })
      .from(phHolidays)
      .where(
        and(
          gte(phHolidays.date, `${monthKey}-01`),
          lte(phHolidays.date, `${monthKey}-31`)
        )
      ),
  ]);

  const targetPercent = resolvePercent(monthKey, periodRows);

  // The whole window feeds the aggregate; only this month's rows seed Calendar.
  // Both are named for their span: swapping them would be invisible otherwise,
  // since computeMonthStats only ever reads the displayed month's weekdays.
  const windowEntries: Entries = Object.fromEntries(
    rows.map((r) => [r.date, r.status])
  );
  const monthEntries: Entries = Object.fromEntries(
    rows
      .filter((r) => r.date.startsWith(monthKey))
      .map((r) => [r.date, r.status])
  );

  // Everything scoped to the displayed month — the banner below and Calendar —
  // takes this list; the widened query above would otherwise surface mandates
  // that ended months ago. A mandate that touches no day of the month can
  // change nothing about it, so the narrowing is exact.
  const monthMandates = mandates.filter((x) =>
    mandateTouchesMonth(x, monthKey)
  );

  // Two numbers, not the earlier months' entries: only the displayed month is
  // editable from here, so everything before it is constant for the life of the
  // mount and the client can re-run the single ceil on its own.
  const fyBaseline: FyBaseline | null =
    windowStart === null
      ? null
      : {
          windowStartMonth: windowStart,
          prior: aggregateMonths(
            monthsBetween(windowStart, shiftMonthKey(monthKey, -1)),
            windowEntries,
            periodRows,
            mandates
          ),
        };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-fade uppercase">
            Attendance record
          </p>
          <div className="flex items-baseline gap-4">
            <Link
              href="/settings"
              className="font-mono text-[11px] tracking-[0.2em] text-fade uppercase underline-offset-4 hover:text-ink hover:underline"
            >
              Settings
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button
                type="submit"
                className="font-mono text-[11px] tracking-[0.2em] text-fade uppercase underline-offset-4 hover:text-ink hover:underline"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {MONTH_NAMES[month - 1]} {year}
          </h1>
          <nav className="flex items-center gap-1" aria-label="Change month">
            <Link
              href={`/?m=${shiftMonthKey(monthKey, -1)}`}
              aria-label="Previous month"
              className="border border-rule px-3 py-1.5 font-mono text-sm hover:bg-ink/5"
            >
              ←
            </Link>
            <Link
              href={`/?m=${shiftMonthKey(monthKey, 1)}`}
              aria-label="Next month"
              className="border border-rule px-3 py-1.5 font-mono text-sm hover:bg-ink/5"
            >
              →
            </Link>
          </nav>
        </div>
        {monthMandates.length > 0 && (
          <div className="mt-4 space-y-1 border-l-2 border-fade pl-3">
            {monthMandates.map((x) => (
              <p key={x.id} className="font-mono text-xs text-fade">
                Mandated WFH{" "}
                {x.endDate === null
                  ? `from ${formatDate(x.startDate)} — until further notice`
                  : `${formatDate(x.startDate)} – ${formatDate(x.endDate)}`}
                {x.reason ? ` (${x.reason})` : ""}
              </p>
            ))}
          </div>
        )}
      </header>

      {/* Keyed by month: search-param navigation re-renders rather than
          remounts, and Calendar seeds its state from initialEntries only on
          mount. Without the key, sliding months keeps the previous month's
          entries and the new month renders blank. */}
      <Calendar
        key={monthKey}
        monthKey={monthKey}
        initialEntries={monthEntries}
        holidays={monthHolidays}
        targetPercent={targetPercent}
        // Nothing in the component asks about a day outside this month, so the
        // window-wide list would only ship extra JSON — reason strings included,
        // which never render there. aggregateMonths above still needs the wide one.
        mandates={monthMandates}
        fyBaseline={fyBaseline}
      />
    </main>
  );
}

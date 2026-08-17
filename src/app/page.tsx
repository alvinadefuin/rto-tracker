import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, lte } from "drizzle-orm";
import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { dayEntries, rtoTargets } from "@/db/schema";
import { resolvePercent, type Entries } from "@/lib/rto";
import { Calendar } from "@/components/calendar";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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

const pad = (n: number) => String(n).padStart(2, "0");

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

function shiftMonth(year: number, month: number, delta: number): string {
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const { m } = await searchParams;
  const monthKey = m && MONTH_RE.test(m) ? m : currentMonthKey();
  const [year, month] = monthKey.split("-").map(Number);

  const rows = await db
    .select({ date: dayEntries.date, status: dayEntries.status })
    .from(dayEntries)
    .where(
      and(
        eq(dayEntries.userId, session.user.id),
        gte(dayEntries.date, `${monthKey}-01`),
        lte(dayEntries.date, `${monthKey}-31`)
      )
    );

  const entries: Entries = Object.fromEntries(
    rows.map((r) => [r.date, r.status])
  );

  const periodRows = await db
    .select({
      startMonth: rtoTargets.startMonth,
      endMonth: rtoTargets.endMonth,
      percent: rtoTargets.percent,
    })
    .from(rtoTargets)
    .where(eq(rtoTargets.userId, session.user.id));

  const targetPercent = resolvePercent(monthKey, periodRows);

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
              href={`/?m=${shiftMonth(year, month, -1)}`}
              aria-label="Previous month"
              className="border border-rule px-3 py-1.5 font-mono text-sm hover:bg-ink/5"
            >
              ←
            </Link>
            <Link
              href={`/?m=${shiftMonth(year, month, 1)}`}
              aria-label="Next month"
              className="border border-rule px-3 py-1.5 font-mono text-sm hover:bg-ink/5"
            >
              →
            </Link>
          </nav>
        </div>
      </header>

      {/* Keyed by month: search-param navigation re-renders rather than
          remounts, and Calendar seeds its state from initialEntries only on
          mount. Without the key, sliding months keeps the previous month's
          entries and the new month renders blank. */}
      <Calendar
        key={monthKey}
        year={year}
        month={month}
        initialEntries={entries}
        targetPercent={targetPercent}
      />
    </main>
  );
}

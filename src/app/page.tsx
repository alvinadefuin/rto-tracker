import { redirect } from "next/navigation";
import { and, eq, gte, lte } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { dayEntries } from "@/db/schema";
import type { Entries } from "@/lib/rto";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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

  return (
    <main>
      <h1>
        RTO Tracker — {year}-{month}
      </h1>
      <pre>{JSON.stringify(entries)}</pre>
    </main>
  );
}

"use server";

import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { dayEntries } from "@/db/schema";
import { isWeekend, type DayStatus } from "@/lib/rto";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: DayStatus[] = ["office", "leave", "holiday"];

export async function setDayStatus(date: string, status: DayStatus | null) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  if (!DATE_RE.test(date)) throw new Error(`Invalid date: ${date}`);
  if (isWeekend(date)) throw new Error(`Weekends cannot be marked: ${date}`);
  if (status !== null && !STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const userId = session.user.id;

  if (status === null) {
    await db
      .delete(dayEntries)
      .where(and(eq(dayEntries.userId, userId), eq(dayEntries.date, date)));
  } else {
    await db
      .insert(dayEntries)
      .values({ userId, date, status })
      .onConflictDoUpdate({
        target: [dayEntries.userId, dayEntries.date],
        set: { status },
      });
  }
}

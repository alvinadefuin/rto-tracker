"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dayEntries } from "@/db/schema";
import { requireUserId } from "@/lib/require-user";
import { isWeekend, type DayStatus } from "@/lib/rto";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: DayStatus[] = ["office", "leave", "holiday"];

export async function setDayStatus(date: string, status: DayStatus | null) {
  const userId = await requireUserId();

  if (!DATE_RE.test(date)) throw new Error(`Invalid date: ${date}`);
  if (isWeekend(date)) throw new Error(`Weekends cannot be marked: ${date}`);
  if (status !== null && !STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

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

  // The client cache reuses page payloads on browser back/forward, so without
  // this an edit would vanish from the render when navigating back to its
  // month. Search params aren't part of the route, so "/" covers every ?m=.
  revalidatePath("/");
}

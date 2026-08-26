"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lte, min } from "drizzle-orm";
import { db } from "@/db";
import { dayEntries, phHolidays } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireUserId } from "@/lib/require-user";
import { financialYearBounds, formatFinancialYear } from "@/lib/rto";
import {
  formatImportSummary,
  parseHolidayIcs,
  planHolidayImport,
} from "@/lib/holidays";

/**
 * Google's public Philippine holiday calendar. The `#` and `@` are
 * percent-encoded because they belong to the calendar id, not to URL syntax.
 *
 * Chosen over Nager.Date, which omits Eid al-Fitr, Eid al-Adha, Maulid un-Nabi
 * and All Souls' Day — five weekday holidays in 2026 alone — and cannot
 * separate observances from holidays. The country is hardcoded for the same
 * reason FY_START_MONTH is: one employer, one calendar.
 */
const ICS_URL =
  "https://calendar.google.com/calendar/ical/" +
  "en.philippines%23holiday%40group.v.calendar.google.com/public/basic.ics";

const FETCH_TIMEOUT_MS = 10_000;

export async function importHolidays(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();

  const fy = Number(formData.get("fy"));
  // A sanity bound on the input, not a claim about what the feed covers. A
  // hardcoded coverage window would rot as Google rolls the feed forward; the
  // out-of-range case below discovers the real edge instead.
  if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) {
    return { error: "Pick a financial year." };
  }

  const { startMonth, endMonth } = financialYearBounds(fy);
  const startDate = `${startMonth}-01`;
  // July has 31 days, and against a fixed-width key a bound past a short
  // month's end is harmless anyway — the same trick page.tsx uses.
  const endDate = `${endMonth}-31`;

  // One Promise.all: neon-http opens an HTTPS request per query with no
  // pipelining, so every extra await is a full round trip.
  const [[firstRow], existingRows] = await Promise.all([
    db
      .select({ first: min(dayEntries.date) })
      .from(dayEntries)
      .where(eq(dayEntries.userId, userId)),
    db
      .select({ date: dayEntries.date })
      .from(dayEntries)
      .where(
        and(
          eq(dayEntries.userId, userId),
          gte(dayEntries.date, startDate),
          lte(dayEntries.date, endDate)
        )
      ),
  ]);

  let ics: string;
  try {
    const response = await fetch(ICS_URL, {
      // Caching is opt-in in this Next version, so this is explicit rather than
      // load-bearing: an import must read the feed as it is right now.
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    ics = await response.text();
  } catch {
    return { error: "Couldn't reach the holiday feed. Try again." };
  }

  const holidays = parseHolidayIcs(ics);
  // Zero events from a feed that answered is a format change, not a year
  // without holidays. Reporting it as a successful import of nothing is exactly
  // how a silently changed feed would go unnoticed for a year.
  if (holidays.length === 0) {
    return {
      error: "The holiday feed format has changed — no holidays could be read.",
    };
  }

  const plan = planHolidayImport(
    holidays,
    startDate,
    endDate,
    existingRows.map((r) => r.date),
    firstRow?.first ?? null
  );

  // Nothing at all landed in range — a different fact from "nothing new to
  // write", which reads as "0 marked · 18 already marked" further down.
  if (
    plan.toInsert.length === 0 &&
    plan.alreadyMarked === 0 &&
    plan.beforeRecord === 0
  ) {
    return {
      error: `The feed has no holidays for ${formatFinancialYear(fy)}.`,
    };
  }

  if (plan.toInsert.length > 0) {
    // One statement, so atomic even without a transaction — neon-http has
    // none. The conflict clause closes the race between the read above and
    // this write, and Drizzle throws on an empty values array, hence the guard.
    await db
      .insert(dayEntries)
      .values(
        plan.toInsert.map((holiday) => ({
          userId,
          date: holiday.date,
          status: "holiday" as const,
          note: holiday.name,
        }))
      )
      .onConflictDoNothing();
  }

  if (plan.reference.length > 0) {
    // Replace the year's reference rows rather than upserting them, so a
    // re-import is authoritative: when a tentative Islamic date shifts —
    // Eid al-Fitr moving off 2027-03-10 — the stale row goes instead of
    // accumulating beside the new one.
    //
    // neon-http has no transaction, so a failure between these two statements
    // leaves the year's reference rows missing. Accepted: the table is
    // display-only, nothing computed reads it, and re-running the import
    // restores it.
    //
    // The guard above cannot be false when the action reaches here — toInsert,
    // alreadyMarked and beforeRecord all derive from the same nationwide,
    // in-range set that fills `reference`, so an empty `reference` means all
    // three are zero and the out-of-range error returned further up. It is
    // written anyway, because Drizzle throws on an empty values array and that
    // invariant should not be load-bearing at a distance.
    await db
      .delete(phHolidays)
      .where(and(gte(phHolidays.date, startDate), lte(phHolidays.date, endDate)));
    await db
      .insert(phHolidays)
      .values(plan.reference.map((h) => ({ date: h.date, name: h.name })));
  }

  revalidatePath("/");
  revalidatePath("/settings");
  return { notice: formatImportSummary(plan) };
}

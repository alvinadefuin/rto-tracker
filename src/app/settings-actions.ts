"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { rtoTargets } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireUserId } from "@/lib/require-user";
import {
  formatPeriodRange,
  periodsOverlap,
  toMonthKey,
  type TargetPeriod,
} from "@/lib/rto";

/** Validation failures return a message; auth failures throw. */
function parse(
  formData: FormData
): { ok: true; period: TargetPeriod } | { ok: false; error: string } {
  const startMonth = toMonthKey(String(formData.get("startMonth") ?? ""));
  const rawEnd = String(formData.get("endMonth") ?? "").trim();
  const endMonth = rawEnd === "" ? null : toMonthKey(rawEnd);
  const percent = Number(formData.get("percent"));

  if (startMonth === null) {
    return { ok: false, error: "Start month must be a valid date." };
  }
  if (rawEnd !== "" && endMonth === null) {
    return { ok: false, error: "End month must be a valid date, or blank." };
  }
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: "Percent must be a whole number from 0 to 100." };
  }
  if (endMonth !== null && endMonth < startMonth) {
    return { ok: false, error: "End month cannot be before the start month." };
  }
  return { ok: true, period: { startMonth, endMonth, percent } };
}

/** Returns an error message when `period` collides with an existing row. */
async function overlapError(
  userId: string,
  period: TargetPeriod,
  excludeId?: string
): Promise<string | null> {
  const existing = await db
    .select({
      startMonth: rtoTargets.startMonth,
      endMonth: rtoTargets.endMonth,
      percent: rtoTargets.percent,
    })
    .from(rtoTargets)
    .where(
      excludeId
        ? and(eq(rtoTargets.userId, userId), ne(rtoTargets.id, excludeId))
        : eq(rtoTargets.userId, userId)
    );

  const clash = existing.find((e) => periodsOverlap(e, period));
  if (!clash) return null;
  return `Overlaps an existing period (${formatPeriodRange(clash)}, ${clash.percent}%).`;
}

function revalidate() {
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function addTargetPeriod(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const clash = await overlapError(userId, parsed.period);
  if (clash) return { error: clash };

  await db.insert(rtoTargets).values({ userId, ...parsed.period });
  revalidate();
  return null;
}

export async function updateTargetPeriod(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing period id." };

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const clash = await overlapError(userId, parsed.period, id);
  if (clash) return { error: clash };

  // Scoped by userId so one user cannot address another's row by guessing an id.
  await db
    .update(rtoTargets)
    .set(parsed.period)
    .where(and(eq(rtoTargets.id, id), eq(rtoTargets.userId, userId)));
  revalidate();
  return null;
}

export async function deleteTargetPeriod(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing period id." };

  await db
    .delete(rtoTargets)
    .where(and(eq(rtoTargets.id, id), eq(rtoTargets.userId, userId)));
  revalidate();
  return null;
}

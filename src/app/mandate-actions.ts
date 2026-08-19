"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { wfhMandates } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireUserId } from "@/lib/require-user";
import {
  formatMandateRange,
  isValidDateKey,
  mandatesOverlap,
  type WfhMandate,
} from "@/lib/rto";

const REASON_MAX = 200;

/** Validation failures return a message; auth failures throw. */
function parse(
  formData: FormData
): { ok: true; mandate: WfhMandate } | { ok: false; error: string } {
  const startDate = String(formData.get("startDate") ?? "");
  const rawEnd = String(formData.get("endDate") ?? "").trim();
  const endDate = rawEnd === "" ? null : rawEnd;
  const rawReason = String(formData.get("reason") ?? "").trim();
  const reason = rawReason === "" ? null : rawReason;

  if (!isValidDateKey(startDate)) {
    return { ok: false, error: "Start date must be a real calendar date." };
  }
  if (endDate !== null && !isValidDateKey(endDate)) {
    return {
      ok: false,
      error: "End date must be a real calendar date, or blank.",
    };
  }
  if (endDate !== null && endDate < startDate) {
    return { ok: false, error: "End date cannot be before the start date." };
  }
  if (reason !== null && reason.length > REASON_MAX) {
    return {
      ok: false,
      error: `Reason must be ${REASON_MAX} characters or fewer.`,
    };
  }
  return { ok: true, mandate: { startDate, endDate, reason } };
}

/** Returns an error message when `mandate` collides with an existing row. */
async function overlapError(
  userId: string,
  mandate: WfhMandate,
  excludeId?: string
): Promise<string | null> {
  const existing = await db
    .select({
      startDate: wfhMandates.startDate,
      endDate: wfhMandates.endDate,
    })
    .from(wfhMandates)
    .where(
      excludeId
        ? and(eq(wfhMandates.userId, userId), ne(wfhMandates.id, excludeId))
        : eq(wfhMandates.userId, userId)
    );

  const clash = existing.find((e) => mandatesOverlap(e, mandate));
  if (!clash) return null;
  return `Overlaps an existing mandate (${formatMandateRange(clash)}).`;
}

function revalidate() {
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function addWfhMandate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const clash = await overlapError(userId, parsed.mandate);
  if (clash) return { error: clash };

  await db.insert(wfhMandates).values({ userId, ...parsed.mandate });
  revalidate();
  return null;
}

export async function updateWfhMandate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing mandate id." };

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const clash = await overlapError(userId, parsed.mandate, id);
  if (clash) return { error: clash };

  // Scoped by userId so one user cannot address another's row by guessing an id.
  await db
    .update(wfhMandates)
    .set(parsed.mandate)
    .where(and(eq(wfhMandates.id, id), eq(wfhMandates.userId, userId)));
  revalidate();
  return null;
}

export async function deleteWfhMandate(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing mandate id." };

  await db
    .delete(wfhMandates)
    .where(and(eq(wfhMandates.id, id), eq(wfhMandates.userId, userId)));
  revalidate();
  return null;
}

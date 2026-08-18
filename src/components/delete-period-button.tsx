"use client";

import { useActionState, useEffect, useRef } from "react";
import { deleteTargetPeriod } from "@/app/settings-actions";
import type { ActionState } from "@/lib/action-state";
import {
  DEFAULT_RTO_PERCENT,
  countMonthsInPeriod,
  formatMonth,
  formatPeriodRange,
  type TargetPeriod,
} from "@/lib/rto";

export function DeletePeriodButton({
  id,
  period,
}: {
  id: string;
  period: TargetPeriod;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    deleteTargetPeriod,
    null
  );

  // A successful delete removes this row, so only an error keeps us mounted.
  useEffect(() => {
    if (state?.error) dialogRef.current?.close();
  }, [state]);

  const months = countMonthsInPeriod(period);
  const consequence =
    months === null
      ? `Every month from ${formatMonth(period.startMonth)} onward will revert to the default ${DEFAULT_RTO_PERCENT}% requirement.`
      : `${months} ${months === 1 ? "month" : "months"} will revert to the default ${DEFAULT_RTO_PERCENT}% requirement.`;

  function open() {
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="border border-rule px-2 py-1 font-mono text-[10px] tracking-widest uppercase hover:bg-ink/5"
      >
        Delete
      </button>

      <dialog
        ref={dialogRef}
        className="max-w-sm border border-rule border-t-2 border-t-stamp bg-paper p-5 text-ink backdrop:bg-ink/40"
      >
        <p className="font-semibold">
          Delete the {formatPeriodRange(period)} period?
        </p>
        <p className="mt-2 text-sm">{consequence}</p>
        <form action={formAction} className="mt-4 flex gap-2">
          <input type="hidden" name="id" value={id} />
          <button
            ref={cancelRef}
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="border border-rule px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase hover:bg-ink/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="border border-stamp bg-stamp/10 px-3 py-1.5 font-mono text-[10px] tracking-widest text-stamp uppercase disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Delete period"}
          </button>
        </form>
      </dialog>

      {state?.error && (
        <p role="alert" className="text-sm text-stamp">
          {state.error}
        </p>
      )}
    </>
  );
}

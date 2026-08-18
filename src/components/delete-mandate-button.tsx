"use client";

import { useActionState, useEffect, useRef } from "react";
import { deleteWfhMandate } from "@/app/mandate-actions";
import type { ActionState } from "@/lib/action-state";
import {
  countWeekdaysInMandate,
  formatDate,
  formatMandateRange,
  type WfhMandate,
} from "@/lib/rto";

export function DeleteMandateButton({
  id,
  mandate,
}: {
  id: string;
  mandate: WfhMandate;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    deleteWfhMandate,
    null
  );

  // A successful delete removes this row, so only an error keeps us mounted.
  useEffect(() => {
    if (state?.error) dialogRef.current?.close();
  }, [state]);

  const days = countWeekdaysInMandate(mandate);
  const consequence =
    days === null
      ? `Every working day from ${formatDate(mandate.startDate)} onward will count toward your requirement again.`
      : `${days} working ${days === 1 ? "day" : "days"} will count toward your requirement again.`;

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
          Delete the {formatMandateRange(mandate)} mandate?
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
            {pending ? "Deleting…" : "Delete mandate"}
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

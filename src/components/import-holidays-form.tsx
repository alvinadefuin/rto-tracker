"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { formatFinancialYear } from "@/lib/rto";

/**
 * `financialYears` and `defaultFy` are decided on the server and passed in.
 * Computing them here from the browser clock would produce a different option
 * list than the server rendered and cause a hydration mismatch.
 *
 * Not built on MandateForm: that component treats a `pending` true→false edge
 * without an error as success and resets itself, which would wipe this form's
 * notice. This one keeps its state and shows it.
 */
export function ImportHolidaysForm({
  action,
  financialYears,
  defaultFy,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  financialYears: number[];
  defaultFy: number;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            Financial year
          </span>
          <select
            name="fy"
            defaultValue={defaultFy}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          >
            {financialYears.map((fy) => (
              <option key={fy} value={fy}>
                {formatFinancialYear(fy)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50"
        >
          {pending ? "Importing…" : "Import holidays"}
        </button>
      </div>
      {state?.error && (
        <p
          role="alert"
          className="border-l-2 border-stamp pl-3 text-sm text-stamp"
        >
          {state.error}
        </p>
      )}
      {state?.notice && (
        <p role="status" className="border-l-2 border-fade pl-3 font-mono text-sm">
          {state.notice}
        </p>
      )}
    </form>
  );
}

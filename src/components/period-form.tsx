"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/settings-actions";

export function PeriodForm({
  action,
  initial,
  submitLabel,
  onCancel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: {
    id: string;
    startMonth: string;
    endMonth: string | null;
    percent: number;
  };
  submitLabel: string;
  onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-3">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            From
          </span>
          <input
            type="month"
            name="startMonth"
            required
            defaultValue={initial?.startMonth}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            To
          </span>
          <input
            type="month"
            name="endMonth"
            defaultValue={initial?.endMonth ?? ""}
            className="border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest text-fade uppercase">
            Percent
          </span>
          <input
            type="number"
            name="percent"
            min={0}
            max={100}
            step={1}
            required
            defaultValue={initial?.percent}
            className="w-24 border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="border border-rule px-4 py-2 text-sm hover:bg-ink/5"
          >
            Cancel
          </button>
        )}
      </div>
      <p className="text-xs text-fade">
        Leave <span className="font-mono">To</span> blank for an ongoing period.
      </p>
      {state?.error && (
        <p
          role="alert"
          className="border-l-2 border-stamp pl-3 text-sm text-stamp"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}

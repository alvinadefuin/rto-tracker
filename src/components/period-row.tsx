"use client";

import { useState } from "react";
import { updateTargetPeriod } from "@/app/settings-actions";
import { formatPeriodRange, type TargetPeriod } from "@/lib/rto";
import { DeletePeriodButton } from "@/components/delete-period-button";
import { PeriodForm } from "@/components/period-form";

export function PeriodRow({ id, period }: { id: string; period: TargetPeriod }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="border-b border-rule px-4 py-3 last:border-b-0">
        <PeriodForm
          action={updateTargetPeriod}
          initial={{ id, ...period }}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSuccess={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0">
      <span className="font-mono text-sm">{formatPeriodRange(period)}</span>
      <span className="flex items-center gap-3">
        <span className="font-mono text-sm font-semibold text-stamp">
          {period.percent}%
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="border border-rule px-2 py-1 font-mono text-[10px] tracking-widest uppercase hover:bg-ink/5"
        >
          Edit
        </button>
        <DeletePeriodButton id={id} period={period} />
      </span>
    </li>
  );
}

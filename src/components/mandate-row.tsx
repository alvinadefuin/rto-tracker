"use client";

import { useState } from "react";
import { updateWfhMandate } from "@/app/mandate-actions";
import { formatMandateRange, type WfhMandate } from "@/lib/rto";
import { DeleteMandateButton } from "@/components/delete-mandate-button";
import { MandateForm } from "@/components/mandate-form";

export function MandateRow({
  id,
  mandate,
}: {
  id: string;
  mandate: WfhMandate;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="border-b border-rule px-4 py-3 last:border-b-0">
        <MandateForm
          action={updateWfhMandate}
          initial={{
            id,
            startDate: mandate.startDate,
            endDate: mandate.endDate,
            reason: mandate.reason ?? null,
          }}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSuccess={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0">
      <span className="flex flex-col">
        <span className="font-mono text-sm">{formatMandateRange(mandate)}</span>
        {mandate.reason && (
          <span className="text-xs text-fade">{mandate.reason}</span>
        )}
      </span>
      <span className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="border border-rule px-2 py-1 font-mono text-[10px] tracking-widest uppercase hover:bg-ink/5"
        >
          Edit
        </button>
        <DeleteMandateButton id={id} mandate={mandate} />
      </span>
    </li>
  );
}

import type { Mark } from "@/lib/rto";
import { MARK_TEXT, MarkIcon } from "@/components/status-icons";

const MARKS: Mark[] = ["office", "leave", "holiday", "training", "erase"];

const MARK_LABEL: Record<Mark, string> = {
  office: "Office",
  leave: "Leave",
  holiday: "Holiday",
  training: "Training",
  erase: "Erase",
};

// Literal class strings, so Tailwind's scanner sees every one.
const MARK_ACTIVE: Record<Mark, string> = {
  office: "border-stamp bg-stamp/10 text-stamp",
  leave: "border-leave bg-leave/10 text-leave",
  holiday: "border-holiday bg-holiday/10 text-holiday",
  training: "border-training bg-training/10 text-training",
  erase: "border-ink bg-ink/5 text-ink",
};

/**
 * Stateless: the active mark lives in CalendarBoard, above Calendar's month
 * key. `pulseKey` remounts the toolbar to replay the pulse; 0 means never
 * pulsed.
 */
export function MarkPalette({
  active,
  onSelect,
  pulseKey,
}: {
  active: Mark | null;
  onSelect: (mark: Mark | null) => void;
  pulseKey: number;
}) {
  return (
    <div
      key={pulseKey}
      role="toolbar"
      aria-label="Marks"
      className={`flex flex-wrap gap-2 ${pulseKey > 0 ? "palette-pulse" : ""}`}
    >
      {MARKS.map((mark) => {
        const on = active === mark;
        return (
          <button
            key={mark}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(on ? null : mark)}
            className={`flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[11px] tracking-widest uppercase transition-colors ${
              on ? MARK_ACTIVE[mark] : "border-rule bg-paper text-ink hover:bg-ink/5"
            }`}
          >
            <MarkIcon mark={mark} className={`size-5 ${MARK_TEXT[mark]}`} />
            {MARK_LABEL[mark]}
          </button>
        );
      })}
    </div>
  );
}

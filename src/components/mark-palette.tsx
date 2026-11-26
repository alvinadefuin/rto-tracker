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

// Literal class strings, so Tailwind's scanner sees every one. No text colour:
// the 11px label stays ink for contrast (the tokens fall below 4.5:1 on a
// tint); the border, tint and icon carry the colour.
const MARK_ACTIVE: Record<Mark, string> = {
  office: "border-stamp bg-stamp/10",
  leave: "border-leave bg-leave/10",
  holiday: "border-holiday bg-holiday/10",
  training: "border-training bg-training/10",
  erase: "border-ink bg-ink/5",
};

/**
 * Stateless: the active mark lives in CalendarBoard, above Calendar's month
 * key. `pulseKey` remounts the root so consecutive taps replay the animation;
 * `pulsing` says whether it should run at all, so a remount from a month
 * change (the palette sits inside the keyed Calendar) stays still. The root
 * calls `onPulseEnd` when the animation finishes. Under reduced motion the
 * animation is `none`, animationend never fires and `pulsing` stays true —
 * harmless, as the class does nothing there.
 */
export function MarkPalette({
  active,
  onSelect,
  pulseKey,
  pulsing,
  onPulseEnd,
}: {
  active: Mark | null;
  onSelect: (mark: Mark | null) => void;
  pulseKey: number;
  pulsing: boolean;
  onPulseEnd: () => void;
}) {
  return (
    <div
      key={pulseKey}
      role="group"
      aria-label="Marks"
      onAnimationEnd={onPulseEnd}
      className={`flex flex-wrap gap-2 ${pulsing ? "palette-pulse" : ""}`}
    >
      {MARKS.map((mark) => {
        const on = active === mark;
        return (
          <button
            key={mark}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(on ? null : mark)}
            className={`flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[11px] tracking-widest uppercase text-ink transition-colors ${
              on ? MARK_ACTIVE[mark] : "border-rule bg-paper hover:bg-ink/5"
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

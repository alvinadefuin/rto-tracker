import type { ReactNode } from "react";
import type { Mark } from "@/lib/rto";

// Every mark needs a colour; a total Record fails to compile when a status is
// added, where a ternary would paint the newcomer in the last branch's colour.
export const MARK_TEXT: Record<Mark, string> = {
  office: "text-stamp",
  leave: "text-leave",
  holiday: "text-holiday",
  training: "text-training",
  erase: "text-fade",
};

// 24×24, 1.5px stroke in currentColor. Shapes marked icon-tint take a thinned
// fill of the same colour, which is what makes them two-tone.
const PATHS: Record<Mark, ReactNode> = {
  office: (
    <>
      <path
        className="icon-tint"
        d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h7A1.5 1.5 0 0 1 15 4.5V21"
      />
      <path className="icon-tint" d="M15 9h3.5a1.5 1.5 0 0 1 1.5 1.5V21" />
      <path d="M3 21h18" />
      <path d="M8 7h1.5M11 7h1.5M8 11h1.5M11 11h1.5M8 15h1.5M11 15h1.5" />
      <path d="M17 13h.5M17 16.5h.5" />
    </>
  ),
  leave: (
    <>
      {/* A coconut palm: leave reads as vacation. */}
      <path
        className="icon-tint"
        d="M13 9C10 6.5 6 6.8 3.5 10.5 6.5 8.8 9.8 8.6 13 9zM13 9c2.7-2.3 6-2 8.5 1.5-2.8-1.6-5.7-1.8-8.5-1.5zM13 9c-1-3-3.8-5-7-5 3 .9 5.3 2.7 7 5zM13 9c1-3 3.5-4.8 6.5-4.5-2.8 1-4.9 2.4-6.5 4.5z"
      />
      <circle className="icon-tint" cx="12.2" cy="10.5" r=".8" />
      <circle className="icon-tint" cx="14" cy="10.4" r=".8" />
      <path d="M10 21c1.6-3.6 2.7-7.4 3-12" />
      <path d="M6 21h9" />
    </>
  ),
  holiday: (
    <>
      <path
        className="icon-tint"
        d="M7.5 7.5h9a4.5 4.5 0 0 1-9 0z"
      />
      <path d="M7 3h10l-.5 4.5a4.5 4.5 0 0 1-9 0z" />
      <path d="M12 12v8M8.5 20.5h7" />
    </>
  ),
  training: (
    <>
      <path
        className="icon-tint"
        d="M3 5.5c2.5-1 5.5-1 9 1 3.5-2 6.5-2 9-1V19c-2.5-1-5.5-1-9 1-3.5-2-6.5-2-9-1z"
      />
      <path d="M12 6.5V20" />
    </>
  ),
  erase: (
    <>
      <path
        className="icon-tint"
        d="M14.1 3.8a1.5 1.5 0 0 1 2.1 0l4 4a1.5 1.5 0 0 1 0 2.1L11 19H7l-3.2-3.2a1.5 1.5 0 0 1 0-2.1z"
      />
      <path d="M9 8.9l6.1 6.1" />
      <path d="M11 19h9" />
    </>
  ),
};

/**
 * One palette mark as a two-tone inline SVG — never an emoji, which renders
 * differently on every platform and ignores the palette's colours. Decorative:
 * the button or cell around it carries the accessible name.
 */
export function MarkIcon({
  mark,
  className = "",
}: {
  mark: Mark;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {PATHS[mark]}
    </svg>
  );
}

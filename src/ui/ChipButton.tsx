import type { ReactNode } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  children: ReactNode;
  onClick: () => void;
  glyph?: GlyphName;
  /** The glyph's filled family, for a state that is on. */
  filled?: boolean;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  title?: string;
};

/** A button a chip high, for an act in a row of the details. DESIGN.md "Components". */
export function ChipButton({ children, onClick, glyph, filled = false, pressed, title }: Props) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
      className="focus-ring inline-flex h-chip shrink-0 items-center gap-1.25 rounded-nested bg-raised px-2 text-fg-mid text-small inset-ring inset-ring-line-control transition-colors duration-(--motion-quick) hover:bg-raised-hi hover:text-fg motion-reduce:transition-none"
    >
      {glyph && <Glyph name={glyph} filled={filled} className="text-glyph" />}
      {children}
    </button>
  );
}

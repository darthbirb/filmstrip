import type { ReactNode } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  children: ReactNode;
  onClick: () => void;
  /**
   * Raised for an act on the row, primary and secondary for a field's Save and Cancel, outline
   * for the way to add a value the row has none of yet.
   */
  look?: "raised" | "primary" | "secondary" | "outline";
  /** A pill, as a tag is, rather than the nested corner. */
  round?: boolean;
  glyph?: GlyphName;
  /** The glyph's filled family, for a state that is on. */
  filled?: boolean;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  title?: string;
};

const LOOKS = {
  raised: "bg-raised text-fg-mid inset-ring-line-control hover:bg-raised-hi hover:text-fg",
  secondary:
    "bg-raised text-fg-mid inset-ring-line-control hover:bg-raised-hi hover:text-fg hover:inset-ring-line-control-hi",
  // Already the lightest surface, so the pointer lays a wash over it.
  primary:
    "bg-raised-hi text-fg inset-ring-line-control-hi hover:bg-[linear-gradient(var(--color-wash),var(--color-wash))]",
  outline: "text-fg-dim inset-ring-line-control-hi hover:text-fg hover:inset-ring-line-strong",
};

/** A button a chip high, for an act in a row of the details. DESIGN.md "Components". */
export function ChipButton({
  children,
  onClick,
  look = "raised",
  round = false,
  glyph,
  filled = false,
  pressed,
  title,
}: Props) {
  const roomy = round || look === "primary" || look === "secondary";
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
      className={`focus-ring inline-flex h-chip shrink-0 items-center gap-1.25 text-small inset-ring transition-colors duration-(--motion-quick) motion-reduce:transition-none ${LOOKS[look]} ${roomy ? "px-2.5" : "px-2"} ${round ? "rounded-full" : "rounded-nested"}`}
    >
      {glyph && <Glyph name={glyph} filled={filled} className="text-glyph" />}
      {children}
    </button>
  );
}

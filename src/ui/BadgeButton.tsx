import type { ComponentProps } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = Omit<ComponentProps<"button">, "type" | "title" | "aria-label" | "children"> & {
  glyph: GlyphName;
  /** Its name and its tooltip. */
  label: string;
  pressed?: boolean;
  /** Where it sits on the picture; it is always placed by what holds it. */
  className?: string;
};

/**
 * A glyph that acts, laid over a picture: a `badge` square on the plate's glass, as the cover's
 * pencil is, taking a wash under the pointer. DESIGN.md "Components".
 */
export function BadgeButton({ glyph, label, pressed, className = "", ...button }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      {...button}
      className={`focus-ring hover-wash grid size-badge place-items-center rounded-badge bg-veil text-fg text-glyph-small ${className}`}
    >
      <Glyph name={glyph} />
    </button>
  );
}

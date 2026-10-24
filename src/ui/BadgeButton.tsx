import type { KeyboardEvent } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  glyph: GlyphName;
  /** Its name and its tooltip. */
  label: string;
  onClick: () => void;
  pressed?: boolean;
  tabIndex?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Where it sits on the picture; it is always placed by what holds it. */
  className?: string;
};

/**
 * A glyph that acts, laid over a picture: a `badge` square on the plate's glass, as the cover's
 * pencil is, taking a wash under the pointer. DESIGN.md "Components".
 */
export function BadgeButton({
  glyph,
  label,
  onClick,
  pressed,
  tabIndex,
  onKeyDown,
  className = "",
}: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`focus-ring hover-wash grid size-badge place-items-center rounded-badge bg-veil text-fg text-glyph-small ${className}`}
    >
      <Glyph name={glyph} />
    </button>
  );
}

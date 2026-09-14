import { GLYPHS, type GlyphName } from "./glyphs";

type Props = {
  name: GlyphName;
  /** The filled family, for a glyph that names a thing rather than an action. */
  filled?: boolean;
  /** Mirrored, for the panel on the other side. */
  flip?: boolean;
  className?: string;
};

/** One icon, a square 1em across; its size and ink come from the caller's text classes. */
export function Glyph({ name, filled = false, flip = false, className = "" }: Props) {
  return (
    <span
      aria-hidden="true"
      translate="no"
      data-icon={GLYPHS[name].icon}
      className={`glyph ${filled ? "glyph-fill" : ""} ${flip ? "-scale-x-100" : ""} ${className}`}
    >
      {String.fromCodePoint(GLYPHS[name].code)}
    </span>
  );
}

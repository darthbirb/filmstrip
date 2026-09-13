import { GLYPHS, type GlyphName } from "./glyphs";

type Props = { name: GlyphName; filled?: boolean; className?: string };

/** One icon, a square 1em across; its size and ink come from the caller's text classes. */
export function Glyph({ name, filled = false, className = "" }: Props) {
  return (
    <span
      aria-hidden="true"
      translate="no"
      className={`glyph ${filled ? "glyph-fill" : ""} ${className}`}
    >
      {GLYPHS[name]}
    </span>
  );
}

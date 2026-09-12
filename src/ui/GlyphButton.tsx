import { GLYPHS, type Glyph } from "./glyphs";

type Props = {
  glyph: Glyph;
  label: string;
  onClick: () => void;
  pressed?: boolean;
};

/** A square, rail-sized button showing one glyph; its label is both its name and its tooltip. */
export function GlyphButton({ glyph, label, onClick, pressed }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className="focus-ring flex size-rail shrink-0 items-center justify-center font-glyph text-fg-muted text-icon transition-colors duration-(--motion-quick) hover:bg-hover hover:text-fg active:bg-press motion-reduce:transition-none"
    >
      <span aria-hidden="true">{GLYPHS[glyph]}</span>
    </button>
  );
}

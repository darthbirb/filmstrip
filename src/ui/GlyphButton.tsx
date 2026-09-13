import { GLYPHS, type Glyph } from "./glyphs";

type Props = {
  glyph: Glyph;
  label: string;
  onClick: () => void;
  pressed?: boolean;
};

/** A control-sized square holding one glyph, on a raised ring; its label is its name and tooltip. */
export function GlyphButton({ glyph, label, onClick, pressed }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className="focus-ring grid size-control shrink-0 place-items-center rounded-control bg-raised font-glyph text-fg-mid text-icon inset-ring inset-ring-line-control transition-colors duration-(--motion-quick) hover:bg-raised-hi hover:text-fg active:bg-inset aria-pressed:bg-raised-hi aria-pressed:text-fg motion-reduce:transition-none"
    >
      <span aria-hidden="true">{GLYPHS[glyph]}</span>
    </button>
  );
}

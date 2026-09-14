import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  glyph: GlyphName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  /** Mirrors the glyph, for the panel on the other side. */
  flip?: boolean;
};

/** A control-sized square holding one glyph, on a raised ring; its label is its name and tooltip. */
export function GlyphButton({ glyph, label, onClick, pressed, disabled = false, flip }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="focus-ring grid size-control shrink-0 place-items-center rounded-control bg-raised text-fg-mid text-icon inset-ring inset-ring-line-control transition-colors duration-(--motion-quick) enabled:hover:bg-raised-hi enabled:hover:text-fg enabled:hover:inset-ring-line-control-hi enabled:active:bg-inset disabled:bg-inset disabled:text-fg-faint disabled:inset-ring-line aria-pressed:bg-raised-hi aria-pressed:text-fg aria-pressed:inset-ring-line-control-hi motion-reduce:transition-none"
    >
      <Glyph name={glyph} flip={flip} />
    </button>
  );
}

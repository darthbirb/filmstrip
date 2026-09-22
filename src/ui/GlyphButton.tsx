import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  glyph: GlyphName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  /** The filled family, for a glyph naming a state the button is in rather than an action. */
  filled?: boolean;
  disabled?: boolean;
  /** Mirrors the glyph, for the panel on the other side. */
  flip?: boolean;
  /** For the one that destroys or forgets: red at rest, filled red under the pointer. */
  danger?: boolean;
};

const REST =
  "bg-raised text-fg-mid inset-ring-line-control enabled:hover:bg-raised-hi enabled:hover:text-fg enabled:hover:inset-ring-line-control-hi enabled:active:bg-inset aria-pressed:bg-raised-hi aria-pressed:text-fg aria-pressed:inset-ring-line-control-hi";
const DANGER =
  "bg-danger-tint text-danger inset-ring-line-danger enabled:hover:bg-danger enabled:hover:text-on-danger enabled:active:bg-danger-press";

/** A control-sized square holding one glyph, on a raised ring; its label is its name and tooltip. */
export function GlyphButton({
  glyph,
  label,
  onClick,
  pressed,
  filled,
  disabled = false,
  flip,
  danger = false,
}: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`focus-ring grid size-control shrink-0 place-items-center rounded-control text-icon inset-ring transition-colors duration-(--motion-quick) disabled:bg-inset disabled:text-fg-faint disabled:inset-ring-line motion-reduce:transition-none ${danger ? DANGER : REST}`}
    >
      <Glyph name={glyph} filled={filled} flip={flip} />
    </button>
  );
}

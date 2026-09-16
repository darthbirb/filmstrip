import { formatCount } from "../lib/format";
import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  glyph: GlyphName;
  label: string;
  /** Rides the glyph's corner, since a 2rem square has no room for a pill at its end. */
  count?: number;
  /** Filled names a place, outlined names an action. DESIGN.md "Typography". */
  filled?: boolean;
  selected?: boolean;
  pressed?: boolean;
  onClick: () => void;
};

/** A place in a folded rail: a square of glyph, wearing its count where a row would wear a pill. */
export function RailButton({ glyph, label, count, filled, selected, pressed, onClick }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={selected || undefined}
      aria-pressed={pressed}
      title={count === undefined ? label : `${label} · ${formatCount(count)}`}
      onClick={onClick}
      className={`focus-ring relative grid size-control shrink-0 place-items-center rounded-control text-icon transition-colors duration-(--motion-quick) motion-reduce:transition-none ${
        selected
          ? "bg-plate text-on-plate hover-wash"
          : "text-fg-mid hover:bg-wash hover:text-fg aria-pressed:bg-wash aria-pressed:text-fg"
      }`}
    >
      <Glyph name={glyph} filled={filled} />
      {count !== undefined && (
        <span
          className={`-top-1 -right-1 absolute flex h-mark-badge min-w-mark-badge items-center justify-center rounded-mark-badge px-1 text-micro tabular-nums ring-2 ring-panel ${
            selected ? "bg-fg text-on-plate" : "bg-raised-hi text-fg"
          }`}
        >
          {formatCount(count)}
        </span>
      )}
    </button>
  );
}

import type { MouseEvent } from "react";

import { Glyph } from "./Glyph";

type Props = {
  label: string;
  checked: boolean;
  /** Something in the place is checked, so every box shows and none is invisible. */
  shown: boolean;
  /** A click, with its keys: Shift takes a range, which a change event would not say. */
  onClick: (event: MouseEvent<HTMLInputElement>) => void;
};

/**
 * A tile's selection box, top-right, under the pointer and on every tile once one is checked.
 * Space on the tile is the keyboard's box, so this is never a tab stop. DESIGN.md "Components".
 */
export function SelectBox({ label, checked, shown, onClick }: Props) {
  const drawn = checked
    ? "bg-in-pane text-on-mark"
    : `bg-box inset-ring-(length:--box-ring) group-hover/tile:inset-ring-box-line ${shown ? "inset-ring-box-line-quiet" : "inset-ring-box-line"}`;
  return (
    <span
      className={`absolute top-tile-inset right-tile-inset grid size-badge ${checked || shown ? "" : "opacity-0 group-hover/tile:opacity-100"}`}
    >
      {/* The real box lies unseen over the drawn one; what it holds is the set's, not its own. */}
      <input
        type="checkbox"
        tabIndex={-1}
        aria-label={label}
        checked={checked}
        readOnly
        onClick={onClick}
        className="absolute inset-0 m-0 size-full opacity-0"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none grid place-items-center rounded-badge ${drawn}`}
      >
        {checked && <Glyph name="done" filled className="text-glyph-small" />}
      </span>
    </span>
  );
}

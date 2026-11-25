import type { MouseEvent, ReactNode, Ref } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  /** The label, which never wraps: too little room ends it in an ellipsis instead. */
  children: ReactNode;
  glyph?: GlyphName;
  filled?: boolean;
  /** After the label, quieter than it: a count, or where the button leads. */
  detail?: ReactNode;
  /** Raised carries the move worth making; quiet stands beside it as the lesser one; danger destroys or forgets. */
  tone?: "raised" | "quiet" | "danger";
  /** A raised button a row offers, a chip high in `small` `fg-mid` until the pointer is on it. */
  small?: boolean;
  expanded?: boolean;
  /** Sunk out of reach while what it starts is already asking. */
  disabled?: boolean;
  /** A tooltip, for a button whose key is worth knowing. */
  title?: string;
  /** The click, whose button a picker opened from it anchors to. */
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  ref?: Ref<HTMLButtonElement>;
};

// A label never wraps, and a panel stops before it would. DECISIONS.md "The frame".
const SHAPE =
  "focus-ring flex h-control max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-2.5 text-ui transition-colors duration-(--motion-quick) motion-reduce:transition-none";

const SMALL =
  "focus-ring flex h-chip max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-nested bg-raised px-2 text-fg-mid text-small inset-ring inset-ring-line-control transition-colors duration-(--motion-quick) enabled:hover:bg-raised-hi enabled:hover:text-fg motion-reduce:transition-none";

const TONES = {
  raised:
    "bg-raised text-fg inset-ring inset-ring-line-control enabled:hover:bg-raised-hi enabled:aria-expanded:bg-raised-hi enabled:aria-expanded:inset-ring-line-control-hi",
  quiet:
    "text-fg-mid enabled:hover:bg-wash enabled:hover:text-fg enabled:aria-expanded:bg-raised-hi enabled:aria-expanded:text-fg",
  danger:
    "bg-danger-tint text-danger inset-ring inset-ring-line-danger enabled:hover:bg-danger enabled:hover:text-on-danger enabled:active:bg-danger-press",
};

const DISABLED =
  "disabled:bg-inset disabled:text-fg-dim disabled:inset-ring disabled:inset-ring-line";

/** A named move, in words. Every text button in the app is one of these. DESIGN.md "Shapes". */
export function Button({
  children,
  glyph,
  filled,
  detail,
  tone = "raised",
  small = false,
  expanded,
  disabled = false,
  title,
  onClick,
  ref,
}: Props) {
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
      className={`${small ? SMALL : `${SHAPE} ${TONES[tone]}`} ${DISABLED}`}
    >
      {glyph && (
        <Glyph
          name={glyph}
          filled={filled}
          className={`text-glyph ${disabled ? "text-fg-faint" : "text-fg-dim"}`}
        />
      )}
      <span className="min-w-0 truncate">{children}</span>
      {detail && <span className="shrink-0 text-fg-dim tabular-nums">{detail}</span>}
    </button>
  );
}

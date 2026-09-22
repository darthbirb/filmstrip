import type { ReactNode, Ref } from "react";

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
  expanded?: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
};

// A label never wraps, and a panel stops before it would. DECISIONS.md "The frame".
const SHAPE =
  "focus-ring flex h-control max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-2.5 text-ui transition-colors duration-(--motion-quick) motion-reduce:transition-none";

const TONES = {
  raised: "bg-raised text-fg inset-ring inset-ring-line-control hover:bg-raised-hi",
  quiet: "text-fg-mid hover:bg-wash hover:text-fg aria-expanded:bg-raised-hi aria-expanded:text-fg",
  danger:
    "bg-danger-tint text-danger inset-ring inset-ring-line-danger hover:bg-danger hover:text-on-danger active:bg-danger-press",
};

/** A named move, in words. Every text button in the app is one of these. DESIGN.md "Shapes". */
export function Button({
  children,
  glyph,
  filled,
  detail,
  tone = "raised",
  expanded,
  onClick,
  ref,
}: Props) {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className={`${SHAPE} ${TONES[tone]}`}
    >
      {glyph && <Glyph name={glyph} filled={filled} className="text-fg-dim text-glyph" />}
      <span className="min-w-0 truncate">{children}</span>
      {detail && <span className="shrink-0 text-fg-dim tabular-nums">{detail}</span>}
    </button>
  );
}

import type { ReactNode } from "react";

import { GLYPHS, type Glyph } from "./glyphs";

type Props = {
  children: ReactNode;
  onClick?: () => void;
  /** Standard is faintly filled; quiet fills only under the pointer; accent is the one action a surface leads with. */
  tone?: "standard" | "quiet" | "accent";
  glyph?: Glyph;
  /** A toggle's state; leave unset for a button that only acts. */
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
};

const TONES = {
  standard: "bg-hover text-fg hover:bg-selected active:bg-press",
  quiet: "text-fg-muted hover:bg-hover hover:text-fg active:bg-press",
  accent: "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent",
};

/** A labelled button, the height of a control. DESIGN.md "Components". */
export function Button({
  children,
  onClick,
  tone = "standard",
  glyph,
  pressed,
  disabled,
  title,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      className={`focus-ring inline-flex h-control shrink-0 items-center gap-2 rounded-control px-3 text-ui transition-[background-color,color,scale] duration-(--motion-quick) ease-out active:scale-(--press-scale) disabled:pointer-events-none disabled:bg-transparent disabled:text-fg-faint aria-pressed:bg-selected aria-pressed:text-fg motion-reduce:transition-none motion-reduce:active:scale-100 ${TONES[tone]}`}
    >
      {glyph && (
        <span aria-hidden="true" className="font-glyph text-icon">
          {GLYPHS[glyph]}
        </span>
      )}
      {children}
    </button>
  );
}

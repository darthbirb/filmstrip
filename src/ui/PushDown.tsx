import type { ReactNode } from "react";

type Props = {
  open: boolean;
  /** For a caller that has to cap the box's height or hold it out of a flex. */
  className?: string;
  children?: ReactNode;
};

/** A box arriving under the row above it, growing, lifting and fading as one. DESIGN.md "Shapes". */
export function PushDown({ open, className = "", children }: Props) {
  return (
    <div data-open={open} className={`push-down ${className}`}>
      {/* The row it grows starts at no height, so what it holds needs a box of its own to be clipped by. */}
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

import type { ReactNode } from "react";

// Dark glass, so it reads over any photograph. DESIGN.md "Shapes".
const SHAPE =
  "flex h-badge items-center gap-1 whitespace-nowrap rounded-badge bg-veil px-1.75 text-fg text-small tabular-nums";

type Props = {
  children: ReactNode;
  /** Where it sits on the picture; a plate is always placed by what holds it. */
  className?: string;
};

/** A small fact laid over a picture: a video's length on its tile, a zoom's figure in the pane. */
export function Plate({ children, className = "" }: Props) {
  return <span className={`${SHAPE} ${className}`}>{children}</span>;
}

type ButtonProps = Props & { label: string; onClick: () => void };

/** A plate that is also the way to act on the fact it states. */
export function PlateButton({ children, className = "", label, onClick }: ButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`focus-ring hover-wash ${SHAPE} ${className}`}
    >
      {children}
    </button>
  );
}

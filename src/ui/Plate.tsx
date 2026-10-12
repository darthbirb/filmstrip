import type { ReactNode } from "react";

// Dark glass, so it reads over any photograph. DESIGN.md "Shapes".
const SHAPE = "flex h-badge items-center gap-1 whitespace-nowrap rounded-badge bg-veil px-1.75";

const LOOK = {
  /** A figure: a length, a scale. */
  fact: "text-small tabular-nums text-fg",
  /** A word that marks what the picture is: *Cover*, *First*. */
  mark: "text-eyebrow uppercase text-fg",
  /** What the picture cannot do, said quietly: *No Preview*. */
  note: "text-small text-fg-mid",
};

type Props = {
  children: ReactNode;
  look?: keyof typeof LOOK;
  /** Where it sits on the picture; a plate is always placed by what holds it. */
  className?: string;
};

/** A small fact laid over a picture: a video's length on its tile, a zoom's figure in the pane. */
export function Plate({ children, look = "fact", className = "" }: Props) {
  return <span className={`${SHAPE} ${LOOK[look]} ${className}`}>{children}</span>;
}

type ButtonProps = Omit<Props, "look"> & { label: string; onClick: () => void };

/** A plate that is also the way to act on the fact it states. */
export function PlateButton({ children, className = "", label, onClick }: ButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`focus-ring hover-wash ${SHAPE} ${LOOK.fact} ${className}`}
    >
      {children}
    </button>
  );
}

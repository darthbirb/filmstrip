import type { CSSProperties } from "react";

// The mark, drawn from a few choices so its candidates can be compared live. DECISIONS.md "The mark".
export type MarkSpec = {
  frames: readonly string[];
  /** Dark space between frames, in viewBox units; 0 runs them together as one band. */
  gap: number;
  /** Sprockets spaced evenly along the strip, or one centred over each frame. */
  sprockets: "even" | "per-frame";
};

// The mark's colours are literal and stay literal. DECISIONS.md "The mark".
const BODY = "#0D0D0D";
const WINDOW = "#1B1B1B";
const SPROCKET = "#8D8A85";
const EVEN_SPROCKETS = [7, 26.5, 46, 65.5, 85];

/** Where each frame sits across the window, and where each sprocket sits above and below it. */
export function markGeometry(spec: MarkSpec) {
  const count = spec.frames.length;
  const width = (92 - spec.gap * (count - 1)) / count;
  const frames = spec.frames.map((fill, n) => ({ fill, x: 4 + n * (width + spec.gap), width }));
  const sprockets =
    spec.sprockets === "even" ? EVEN_SPROCKETS : frames.map((frame) => frame.x + width / 2 - 4);
  return { frames, sprockets };
}

type Props = { spec: MarkSpec; className?: string; style?: CSSProperties };

export function Mark({ spec, className, style }: Props) {
  const { frames, sprockets } = markGeometry(spec);
  return (
    <svg viewBox="0 0 100 100" role="img" className={className} style={style}>
      <title>Filmstrip</title>
      <rect x="0" y="10" width="100" height="80" rx="6" fill={BODY} />
      <rect x="4" y="26" width="92" height="48" fill={WINDOW} />
      {frames.map((frame) => (
        <rect
          key={frame.x}
          data-frame
          x={frame.x}
          y="26"
          width={frame.width}
          height="48"
          fill={frame.fill}
        />
      ))}
      <g fill={SPROCKET}>
        {sprockets.flatMap((x) => [
          <rect key={`top-${x}`} data-sprocket x={x} y="14" width="8" height="8" rx="2" />,
          <rect key={`bottom-${x}`} x={x} y="78" width="8" height="8" rx="2" />,
        ])}
      </g>
    </svg>
  );
}

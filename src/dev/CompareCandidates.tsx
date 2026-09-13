import type { ComponentType } from "react";

type Props = {
  candidates: Record<string, ComponentType>;
  /** Side by side, or stacked: a layout is judged at full width. */
  layout?: "columns" | "rows";
};

/** Every candidate at once, each still driving the real window. */
export function CompareCandidates({ candidates, layout = "columns" }: Props) {
  const entries = Object.entries(candidates);
  const tracks = `repeat(${entries.length}, minmax(0, 1fr))`;
  const rows = layout === "rows";
  return (
    <div
      className="grid h-full min-h-0 flex-1"
      style={rows ? { gridTemplateRows: tracks } : { gridTemplateColumns: tracks }}
    >
      {entries.map(([name, Candidate], index) => (
        <section
          key={name}
          aria-label={name}
          className={`relative flex min-h-0 min-w-0 flex-col border-line-control-hi ${rows ? "border-b last:border-b-0" : "border-r last:border-r-0"}`}
        >
          <Candidate />
          <span className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2 bg-ground px-2 py-1 text-small">
            {index + 1} {name}
          </span>
        </section>
      ))}
    </div>
  );
}

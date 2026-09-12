import type { ComponentType } from "react";

import { StandIn } from "./StandIn";

type Props = { candidates: Record<string, ComponentType> };

/** Every candidate at once, each over the same stand-in, each still driving the real window. */
export function CompareCandidates({ candidates }: Props) {
  const entries = Object.entries(candidates);
  return (
    <div
      className="grid min-h-0 flex-1"
      style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}
    >
      {entries.map(([name, Candidate], index) => (
        <section
          key={name}
          aria-label={name}
          className="relative flex min-h-0 min-w-0 flex-col border-fg-muted border-r last:border-r-0"
        >
          <Candidate />
          <StandIn label={`${index + 1} ${name}`} />
        </section>
      ))}
    </div>
  );
}

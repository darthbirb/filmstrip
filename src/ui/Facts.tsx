import { Fragment, type ReactNode } from "react";

export type Fact = readonly [term: string, value: ReactNode];

/** Terms and their values in two aligned columns: what the pane knows about a file. */
export function Facts({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
      {facts.map(([term, value]) => (
        <Fragment key={term}>
          <dt className="text-fg-muted">{term}</dt>
          <dd className="m-0 min-w-0 break-words font-numeric text-fg">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

import { Fragment, type ReactNode } from "react";

export type Fact = readonly [term: string, value: ReactNode];

/** Terms in a capital column as wide as the longest, beside their values; each row a chip high. */
export function Facts({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
      {facts.map(([term, value]) => (
        <Fragment key={term}>
          <dt className="text-eyebrow text-fg-dim uppercase leading-(--spacing-chip)">{term}</dt>
          <dd className="m-0 min-w-0 break-words text-fg-mid text-ui tabular-nums leading-(--spacing-chip)">
            {value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

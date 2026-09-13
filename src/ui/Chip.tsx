import type { ReactNode } from "react";

/** A measured value as a chip: a shape, a length, a size. Quiet for what only names a kind. */
export function Stat({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return (
    <span
      className={`inline-flex h-chip items-center rounded-nested bg-raised px-2 text-small tabular-nums ${quiet ? "text-fg-mid" : "text-fg"}`}
    >
      {children}
    </span>
  );
}

type Props = {
  value: string;
  /** A label's key. A label is never shown without it. PRODUCT.md "Tags and labels". */
  tagKey?: string | null;
  /** Carried down from a folder rather than set on the item itself. */
  inherited?: boolean;
  title?: string;
};

/** A tag is a pill; a label is a split chip, its key sunk. Inherited ones sit quieter than an item's own. */
export function Chip({ value, tagKey, inherited = false, title }: Props) {
  if (tagKey) {
    return (
      <span
        title={title}
        className="inline-flex h-chip max-w-full overflow-hidden rounded-nested text-small"
      >
        <span className="flex items-center bg-well px-2 text-fg-dim">{tagKey}</span>
        <span
          className={`flex min-w-0 items-center px-2 ${inherited ? "bg-inset text-fg-mid" : "bg-raised text-fg"}`}
        >
          <span className="truncate">{value}</span>
        </span>
      </span>
    );
  }
  return (
    <span
      title={title}
      className={`inline-flex h-chip max-w-full items-center rounded-full px-2.5 text-small inset-ring ${inherited ? "bg-inset text-fg-dim inset-ring-line" : "bg-raised text-fg inset-ring-line-control-hi"}`}
    >
      <span className="truncate">{value}</span>
    </span>
  );
}

import type { MouseEvent, ReactNode } from "react";

import { Glyph } from "./Glyph";

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
  /** A folder's name, marked with the folder glyph; only renaming the folder changes it. */
  name?: boolean;
  title?: string;
  /** Makes the chip a control that searches for it; `adding` when Ctrl was held. */
  onSearch?: (adding: boolean) => void;
};

// One step lighter under the pointer, in the hairline ring a tile takes. Pane › the details' search.
const SEARCHING = "cursor-default focus-ring hover:ring-1 hover:ring-line-strong";

/** A tag is a pill; a label is a split chip, its key sunk. Inherited ones sit quieter than an item's own. */
export function Chip({ value, tagKey, inherited = false, name = false, title, onSearch }: Props) {
  const Tag = onSearch ? "button" : "span";
  const control = onSearch && {
    type: "button" as const,
    onClick: (event: MouseEvent) => onSearch(event.ctrlKey || event.metaKey),
  };
  if (tagKey) {
    return (
      <Tag
        {...control}
        title={title}
        className={`group inline-flex h-chip max-w-full overflow-hidden rounded-nested text-small ${onSearch ? SEARCHING : ""}`}
      >
        <span className="flex items-center bg-well px-2 text-fg-dim">{tagKey}</span>
        <span
          className={`flex min-w-0 items-center px-2 ${inherited ? "bg-inset text-fg-mid" : "bg-raised text-fg"} ${onSearch ? "group-hover:bg-raised-hi group-hover:text-fg" : ""}`}
        >
          <span className="truncate">{value}</span>
        </span>
      </Tag>
    );
  }
  return (
    <Tag
      {...control}
      title={title}
      className={`inline-flex h-chip max-w-full items-center gap-1.25 rounded-full pr-2.5 text-small inset-ring ${name ? "pl-2" : "pl-2.5"} ${inherited ? "bg-inset text-fg-dim inset-ring-line" : "bg-raised text-fg inset-ring-line-control-hi"} ${onSearch ? `${SEARCHING} hover:bg-raised-hi hover:text-fg` : ""}`}
    >
      {name && (
        <Glyph name="folderName" className={`text-glyph-small ${inherited ? "" : "text-fg-dim"}`} />
      )}
      <span className="truncate">{value}</span>
    </Tag>
  );
}

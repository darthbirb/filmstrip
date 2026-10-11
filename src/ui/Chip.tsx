import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

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
  /** A tag its owner can take off: an × under the pointer or the keyboard, and Delete. */
  onRemove?: () => void;
  /** The one a value being typed repeats, outlined while the field refuses it. */
  echoed?: boolean;
  /** A label's value its owner can change: a click on that half opens it. */
  onEdit?: () => void;
};

// One step lighter under the pointer, in the hairline ring a tile takes. Pane › the details' search.
const SEARCHING = "cursor-default focus-ring hover:ring-1 hover:ring-line-strong";

/** A tag is a pill; a label is a split chip, its key sunk. Inherited ones sit quieter than an item's own. */
export function Chip({
  value,
  tagKey,
  inherited = false,
  name = false,
  title,
  onSearch,
  onRemove,
  echoed = false,
  onEdit,
}: Props) {
  const control = onSearch && {
    type: "button" as const,
    onClick: (event: MouseEvent) => onSearch(event.ctrlKey || event.metaKey),
  };
  const removeKey = (event: KeyboardEvent) => {
    if (!onRemove || (event.key !== "Delete" && event.key !== "Backspace")) return;
    event.preventDefault();
    onRemove();
  };
  const cross = onRemove && (
    <button
      type="button"
      tabIndex={-1}
      title="Remove"
      aria-label={`Remove ${tagKey ? `${tagKey}: ` : ""}${value}`}
      onClick={onRemove}
      className="hidden size-4.5 shrink-0 place-items-center rounded-full text-fg-mid text-glyph-small hover:bg-wash hover:text-fg group-hover:grid group-has-focus-visible:grid"
    >
      <Glyph name="close" />
    </button>
  );
  if (tagKey && onSearch && onRemove && onEdit) {
    // The key searches and the value is changed; Delete on either takes the label off.
    return (
      <span
        data-chip
        className={`group inline-flex h-chip max-w-full overflow-hidden rounded-nested text-small has-focus-visible:outline has-focus-visible:outline-focus has-focus-visible:outline-offset-(--focus-gap) ${echoed ? "ring-1 ring-line-strong" : ""}`}
      >
        <button
          {...control}
          data-removable
          title={title}
          onKeyDown={removeKey}
          className="flex cursor-default items-center bg-well px-2 text-fg-dim outline-none hover:text-fg"
        >
          {tagKey}
        </button>
        <span className="flex min-w-0 items-center gap-0.5 bg-raised pr-2 pl-2 text-fg group-hover:bg-raised-hi group-hover:pr-1 group-has-focus-visible:pr-1">
          <button
            type="button"
            title="Change Value"
            aria-label={`Change ${tagKey}: ${value}`}
            onClick={onEdit}
            onKeyDown={removeKey}
            className="min-w-0 cursor-default truncate outline-none"
          >
            {value}
          </button>
          {cross}
        </span>
      </span>
    );
  }
  const Tag = onSearch ? "button" : "span";
  if (tagKey) {
    return (
      <Tag
        {...control}
        {...(onSearch && { "data-chip": true })}
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
  const ground = inherited
    ? `bg-inset ${echoed ? "text-fg-mid inset-ring-line-strong" : "text-fg-dim inset-ring-line"}`
    : `bg-raised text-fg ${echoed ? "inset-ring-line-strong" : "inset-ring-line-control-hi"}`;
  if (onSearch && onRemove) {
    // The × is the pointer's; the keyboard removes with Delete, so the chip stays one tab stop.
    return (
      <span
        data-chip
        className={`group inline-flex h-chip max-w-full items-center rounded-full text-small inset-ring hover:bg-raised-hi hover:text-fg hover:ring-1 hover:ring-line-strong has-focus-visible:outline has-focus-visible:outline-focus has-focus-visible:outline-offset-(--focus-gap) ${ground}`}
      >
        <button
          {...control}
          data-removable
          title={title}
          onKeyDown={removeKey}
          className="flex h-full min-w-0 cursor-default items-center rounded-full pr-2.5 pl-2.5 outline-none group-hover:pr-0.5 group-has-focus-visible:pr-0.5"
        >
          <span className="truncate">{value}</span>
        </button>
        <span className="flex group-hover:mr-1 group-has-focus-visible:mr-1">{cross}</span>
      </span>
    );
  }
  return (
    <Tag
      {...control}
      {...(onSearch && { "data-chip": true })}
      title={title}
      className={`inline-flex h-chip max-w-full items-center gap-1.25 rounded-full pr-2.5 text-small inset-ring ${name ? "pl-2" : "pl-2.5"} ${ground} ${onSearch ? `${SEARCHING} hover:bg-raised-hi hover:text-fg` : ""}`}
    >
      {name && (
        <Glyph name="folderName" className={`text-glyph-small ${inherited ? "" : "text-fg-dim"}`} />
      )}
      <span className="truncate">{value}</span>
    </Tag>
  );
}

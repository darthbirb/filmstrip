type Props = {
  value: string;
  /** A label's key. A label is never shown without it. PRODUCT.md "Tags and labels". */
  tagKey?: string | null;
  /** Carried down from a folder rather than set on the item itself. */
  inherited?: boolean;
  title?: string;
};

/** A tag, or a label with its key, filled when the item carries it and outlined when inherited. */
export function Chip({ value, tagKey, inherited = false, title }: Props) {
  return (
    <span
      title={title}
      className={`inline-flex h-chip max-w-full items-center gap-1 rounded-control px-2 text-caption ${inherited ? "border border-line-strong text-fg-muted" : "bg-hover text-fg"}`}
    >
      {tagKey && <span className="text-fg-muted">{tagKey}:</span>}
      <span className="truncate">{value}</span>
    </span>
  );
}

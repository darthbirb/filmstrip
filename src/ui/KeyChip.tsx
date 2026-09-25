type Props = {
  /** The digit. */
  digit: string;
  /** On a plated row, it sinks into the plate as the count does. */
  plated?: boolean;
  /** Its folder has gone: the key is kept, in the red. */
  broken?: boolean;
};

/** A destination key, drawn as a key: its digit in a `badge` square. DESIGN.md "Components". */
export function KeyChip({ digit, plated = false, broken = false }: Props) {
  const tone = broken
    ? "bg-inset text-danger inset-ring inset-ring-line-danger"
    : plated
      ? "bg-on-plate-wash text-on-plate-dim"
      : "bg-inset text-fg-mid inset-ring inset-ring-line-control";
  return (
    <span
      title={`Destination Key ${digit}`}
      className={`grid size-badge shrink-0 place-items-center rounded-badge font-mono text-key ${tone}`}
    >
      {digit}
    </span>
  );
}

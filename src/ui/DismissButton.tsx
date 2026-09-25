import { Glyph } from "./Glyph";

type Props = {
  /** Its name, and its tooltip, which may carry its key. */
  label: string;
  title?: string;
  onClick: () => void;
};

/** A quiet × that puts something away: no ring at rest, the wash under the pointer. DESIGN.md "Components". */
export function DismissButton({ label, title = label, onClick }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className="focus-ring grid size-control shrink-0 place-items-center rounded-control text-fg-dim text-glyph transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg motion-reduce:transition-none"
    >
      <Glyph name="close" />
    </button>
  );
}

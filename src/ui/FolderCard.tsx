import type { Matched } from "../ipc/bindings/Matched";
import { CountPill } from "./Count";
import { Glyph } from "./Glyph";
import { TermChip } from "./TermChip";

type Props = {
  title: string;
  /** The files directly in it, and every file at or below it. */
  own: number;
  count: number;
  /** The folders above it, its source's first. */
  above: readonly string[];
  matched: Matched;
  /** The picture that stands for it, as a URL the window can load. */
  cover?: string;
  onOpen: () => void;
  /** Asks the same question again inside this folder. */
  onScope: () => void;
};

/**
 * A folder a search found: its cover, its name and count, where it is, and what it matched on,
 * key first. Two targets: the card is the folder, so a click goes into it; the glass is the
 * search, so a click asks again inside it. Artboards › A search is a place.
 */
export function FolderCard({ title, own, count, above, matched, cover, onOpen, onScope }: Props) {
  return (
    // The glass is the card's sibling, not its child: a button cannot hold a button.
    <div className="relative w-card shrink-0">
      <button
        type="button"
        title={`Open ${title}`}
        onClick={onOpen}
        className="focus-ring flex w-full gap-2.5 rounded-control bg-panel p-2 text-left inset-ring inset-ring-line transition-colors duration-(--motion-quick) hover:bg-inset hover:inset-ring-line-strong motion-reduce:transition-none"
      >
        <span className="h-card-cover w-card-cover shrink-0 overflow-hidden rounded-badge bg-raised">
          {cover && <img src={cover} alt="" draggable={false} className="size-full object-cover" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.75 pr-6">
          <span className="flex min-w-0 items-center gap-1.5 text-fg text-row">
            <span className="truncate font-semibold">{title}</span>
            <CountPill own={own} all={count} />
          </span>
          {above.length > 0 && (
            <span className="truncate text-fg-dim text-small">in {above.join(" / ")}</span>
          )}
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-fg-dim text-small">
            {matched.kind === "name" ? (
              <>
                Name <span className="truncate text-fg">{matched.value}</span>
              </>
            ) : matched.kind === "tag" ? (
              <>
                Tag <TermChip shape={matched} text={`tag:${matched.value}`} />
              </>
            ) : (
              <>
                Label <TermChip shape={matched} text={`${matched.key}:${matched.value}`} />
              </>
            )}
          </span>
        </span>
      </button>
      <button
        type="button"
        title="Search in Folder"
        aria-label={`Search in ${title}`}
        onClick={onScope}
        className="focus-ring absolute top-2 right-2 grid size-6 place-items-center rounded-nested text-fg-dim text-glyph transition-colors duration-(--motion-quick) hover:bg-raised-hi hover:text-fg motion-reduce:transition-none"
      >
        <Glyph name="search" />
      </button>
    </div>
  );
}

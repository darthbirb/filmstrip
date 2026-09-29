import type { Matched } from "../ipc/bindings/Matched";
import { formatCount } from "../lib/format";
import { TermChip } from "./TermChip";

type Props = {
  title: string;
  /** Every file at or below it. */
  count: number;
  /** The folders above it, its source's first. */
  above: readonly string[];
  matched: Matched;
  /** The picture that stands for it, as a URL the window can load. */
  cover?: string;
  onOpen: () => void;
};

/**
 * A folder a search found: its cover, its name and count, where it is, and what it matched on,
 * key first. The card is the folder, so a click goes into it. Artboards › A search is a place.
 */
export function FolderCard({ title, count, above, matched, cover, onOpen }: Props) {
  return (
    <button
      type="button"
      title={`Open ${title}`}
      onClick={onOpen}
      className="focus-ring relative flex w-card shrink-0 gap-2.5 rounded-control bg-panel p-2 text-left inset-ring inset-ring-line transition-colors duration-(--motion-quick) hover:bg-inset hover:inset-ring-line-strong motion-reduce:transition-none"
    >
      <span className="h-card-cover w-card-cover shrink-0 overflow-hidden rounded-badge bg-raised">
        {cover && <img src={cover} alt="" draggable={false} className="size-full object-cover" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.75 pr-6">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-fg text-row">
          <span className="truncate">{title}</span>
          <span className="flex h-badge shrink-0 items-center rounded-badge bg-raised px-1.75 font-normal text-fg-mid text-small tabular-nums inset-ring inset-ring-line-control">
            {formatCount(count)}
          </span>
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
  );
}

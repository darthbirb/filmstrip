import { useEffect } from "react";

import { formatBytes, formatCount } from "../../lib/format";
import { countWords } from "../../ui/Count";
import { Glyph } from "../../ui/Glyph";
import { setBandOpen, useBandOpen } from "../grid/folder-detail";
import { type Place, setPlace, usePlace } from "../place";
import { SearchHeader } from "../search/SearchHeader";
import { ensureChildren, useIndex } from "./index-store";

/** Where the user is: a folder's header opens its details; the app's own places only name themselves. */
export function Breadcrumb() {
  const place = usePlace();
  if (!place) return null;
  if (place.kind === "search") return <SearchHeader place={place} />;
  if (place.kind === "folder") return <FolderHeader place={place} />;
  return <PlainHeader place={place} />;
}

/** The Sorting Box says what waits in it, the Trash what it holds and its size. */
function PlainHeader({ place }: { place: Place & { kind: "sorting" | "trash" } }) {
  const { sources, trash } = useIndex();
  const waiting = (sources ?? [])
    .filter((source) => source.kind === "sorting")
    .reduce((sum, source) => sum + source.itemCount, 0);
  const count =
    place.kind === "trash"
      ? trash && trash.count > 0 && `${formatCount(trash.count)} · ${formatBytes(trash.bytes)}`
      : waiting > 0 && `${formatCount(waiting)} waiting`;
  return (
    <nav aria-label="Location" className="flex min-w-0 flex-1 items-center gap-1.5 pl-3">
      <span aria-current="location" className="truncate text-fg-hi text-title">
        {place.kind === "trash" ? "Trash" : "Sorting Box"}
      </span>
      {count && (
        <span className="shrink-0 whitespace-nowrap text-fg-dim text-small tabular-nums">
          {count}
        </span>
      )}
    </nav>
  );
}

/**
 * The chevron, every folder above as a quiet step back, the folder as the grid's title, and its
 * two counts in words. The whole header opens the band; only the steps back are buttons of their
 * own, laid over the one that opens it. DECISIONS.md "A folder's details".
 */
function FolderHeader({ place }: { place: Place & { kind: "folder" } }) {
  const { sources, children } = useIndex();
  const open = useBandOpen();
  const source = sources?.find((candidate) => candidate.id === place.sourceId);
  const offline = source !== undefined && !source.reachable;
  const here = place.path.at(-1);
  const parent = place.path.at(-2);
  const parentId = parent?.id;
  const node = parent && children.get(parent.id)?.find((child) => child.id === here?.id);
  const figures = parent
    ? node && { own: node.itemCount, all: node.allCount }
    : source && { own: source.rootCount, all: source.itemCount };
  // A folder reached by a search may sit under one the tree has never opened.
  useEffect(() => {
    if (parentId !== undefined) ensureChildren([parentId]);
  }, [parentId]);

  return (
    <div className="relative ml-1 flex h-control min-w-0 flex-1 items-center gap-1 px-1">
      <button
        type="button"
        aria-label="Details"
        aria-expanded={open}
        onClick={() => setBandOpen(!open)}
        className={`focus-ring absolute inset-0 rounded-control transition-colors duration-(--motion-quick) motion-reduce:transition-none ${open ? "bg-raised" : "hover:bg-wash"}`}
      />
      <span className="pointer-events-none relative grid w-chevron shrink-0 place-items-center text-fg-mid text-icon">
        <Glyph name={open ? "chevronDown" : "chevronRight"} />
      </span>
      <nav aria-label="Location" className="pointer-events-none relative flex min-w-0">
        <ol className="flex min-w-0 items-center gap-1">
          {place.path.slice(0, -1).map((crumb, index) => (
            <li key={crumb.id} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                className={`focus-ring pointer-events-auto flex h-control min-w-0 items-center rounded-nested px-1.5 text-row transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg motion-reduce:transition-none ${offline ? "text-fg-dim" : "text-fg-mid"}`}
                onClick={() => setPlace({ ...place, path: place.path.slice(0, index + 1) })}
              >
                <span className="truncate">{crumb.title}</span>
              </button>
              <Glyph name="chevronRight" className="text-fg-faint text-glyph" />
            </li>
          ))}
          <li className="flex min-w-0 items-center">
            <span
              aria-current="location"
              className={`truncate px-1 text-title ${offline ? "text-fg-mid" : "text-fg-hi"}`}
            >
              {here?.title}
            </span>
          </li>
        </ol>
      </nav>
      {/* The drive cannot vouch for a count while it is away, so the header says why instead. */}
      {offline ? (
        <span className="pointer-events-none relative shrink-0 pl-1.5 font-mono text-fg-dim text-key">
          offline
        </span>
      ) : (
        figures && (
          <span className="pointer-events-none relative shrink-0 whitespace-nowrap pl-1.5 text-fg-dim text-small tabular-nums">
            {countWords(figures)}
          </span>
        )
      )}
    </div>
  );
}

import { useEffect } from "react";

import { formatCount } from "../../lib/format";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ensureChildren, useIndex } from "../navigation/index-store";
import { type Place, setPlace } from "../place";

/** What an empty place says, in its own words, and the one move worth offering. DECISIONS.md "The grid". */
export function EmptyPlace({ place }: { place: Place }) {
  const { sources, children } = useIndex();
  const folder = place.kind === "folder" ? place.path.at(-1) : undefined;
  const folderId = folder?.id;

  useEffect(() => {
    if (folderId !== undefined) ensureChildren([folderId]);
  }, [folderId]);

  if (place.kind === "sorting") {
    return (
      <EmptyState
        glyph="checkCircle"
        title="Nothing To Sort"
        note="Everything that came in has been filed. New files land here as they are found."
      />
    );
  }
  if (place.kind === "trash") {
    return (
      <EmptyState
        glyph="trash"
        title="Trash Is Empty"
        note="Deleted files wait here until you empty it, and can be put back."
      />
    );
  }
  if (!folder) return null;

  // A source that cannot be read still knows what it held, so it says that rather than "empty".
  const source = sources?.find((candidate) => candidate.id === place.sourceId);
  if (source && !source.reachable) {
    return (
      <EmptyState
        glyph="unplugged"
        title={`${source.title} Is Offline`}
        note={`The app knows what is in this source but cannot reach it. Its last count was ${formatCount(source.itemCount)} items.`}
      />
    );
  }

  // Until the folders below are known, no sentence about them would be true yet.
  if (!children.has(folder.id)) return null;
  const inside = children.get(folder.id) ?? [];
  if (inside.length === 0) {
    return (
      <EmptyState
        glyph="folderDashed"
        title="This Folder Is Empty"
        note={`Nothing is in ${folder.title}, on disk or in the index.`}
      />
    );
  }
  return (
    <EmptyState
      glyph="folders"
      title="No Pictures Here"
      note={`${folder.title} holds ${formatCount(inside.length)} ${inside.length === 1 ? "folder" : "folders"} and no loose files.`}
    >
      {inside.map((child) => (
        <Button
          key={child.id}
          glyph="folder"
          filled
          detail={child.itemCount > 0 ? formatCount(child.itemCount) : undefined}
          onClick={() =>
            setPlace({
              kind: "folder",
              sourceId: place.sourceId,
              path: [...place.path, { id: child.id, title: child.title }],
            })
          }
        >
          {child.title}
        </Button>
      ))}
    </EmptyState>
  );
}

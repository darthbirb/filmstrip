import { useEffect, useState } from "react";

import { Tree, type TreeRow } from "../../ui/Tree";
import { type Place, setPlace, usePlace } from "../place";
import { ensureChildren, useIndex } from "./index-store";
import {
  addFolderRows,
  folderRowId,
  libraries,
  NoSources,
  rowFolder,
  SORTING_ID,
  selectedRowId,
  sortingRow,
  sourcePlace,
  sourceRow,
  TRASH_ID,
  trashRow,
} from "./shared";

/** A short list of places, and below it the folders of whichever source is chosen. */
export function PlacesNav() {
  const { sources, children } = useIndex();
  const place = usePlace();
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    ensureChildren([...expanded]);
  }, [expanded]);

  if (!sources) return null;
  if (sources.length === 0) return <NoSources />;

  const places = new Map<string, Place>([
    [SORTING_ID, { kind: "sorting" }],
    [TRASH_ID, { kind: "trash" }],
  ]);
  const top: TreeRow[] = [sortingRow(sources)];
  for (const source of libraries(sources)) {
    const row = sourceRow(source);
    top.push(row);
    places.set(row.id, sourcePlace(source));
  }
  top.push(trashRow());

  const source =
    place?.kind === "folder" ? sources.find((each) => each.id === place.sourceId) : undefined;
  const folders: TreeRow[] = [];
  if (source) {
    const at = sourcePlace(source);
    if (at.kind === "folder") {
      addFolderRows({ children, expanded, sourceId: source.id, rows: folders, places }, at.path, 1);
    }
  }

  const setOpen = (id: string, open: boolean) => {
    const folder = rowFolder(id);
    if (folder === undefined) return;
    const next = new Set(expanded);
    if (open) next.add(folder);
    else next.delete(folder);
    setExpanded(next);
  };
  const select = (id: string) => {
    const target = places.get(id);
    if (target) setPlace(target);
  };

  return (
    <div className="flex flex-col">
      <Tree
        label="Places"
        rows={top}
        selectedId={source ? folderRowId(source.rootFolderId) : selectedRowId(place)}
        onSelect={select}
        onExpand={() => undefined}
        onCollapse={() => undefined}
      />
      {source && (
        <>
          <h2 className="truncate px-3 pt-4 pb-1 text-caption text-fg-muted">
            Folders in {source.title}
          </h2>
          {folders.length > 0 ? (
            <Tree
              label={`Folders in ${source.title}`}
              rows={folders}
              selectedId={selectedRowId(place)}
              onSelect={select}
              onExpand={(id) => setOpen(id, true)}
              onCollapse={(id) => setOpen(id, false)}
            />
          ) : (
            <p className="px-3 py-1 text-fg-muted text-ui">No folders inside.</p>
          )}
        </>
      )}
    </div>
  );
}

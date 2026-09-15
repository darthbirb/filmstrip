import { useEffect, useState } from "react";

import { Tree, type TreeRow } from "../../ui/Tree";
import { type Place, setPlace, usePlace } from "../place";
import { ensureChildren, useIndex } from "./index-store";
import {
  addFolderRows,
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

/** The Sorting Box and the Trash, then each library source with its folders opening in place. DECISIONS.md "Navigation". */
export function Navigation() {
  const { sources, children } = useIndex();
  const place = usePlace();
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    ensureChildren([...expanded]);
  }, [expanded]);

  if (!sources) return null;
  if (sources.length === 0) return <NoSources />;

  const rows: TreeRow[] = [sortingRow(sources), trashRow()];
  const places = new Map<string, Place>([
    [SORTING_ID, { kind: "sorting" }],
    [TRASH_ID, { kind: "trash" }],
  ]);
  libraries(sources).forEach((source, index) => {
    const root = source.rootFolderId;
    const row = sourceRow(source, {
      expandable: (children.get(root)?.length ?? 0) > 0,
      expanded: expanded.has(root),
      separated: index === 0,
    });
    rows.push(row);
    const at = sourcePlace(source);
    places.set(row.id, at);
    if (expanded.has(root) && at.kind === "folder") {
      addFolderRows({ children, expanded, sourceId: source.id, rows, places }, at.path, 2);
    }
  });

  const setOpen = (id: string, open: boolean) => {
    const folder = rowFolder(id);
    if (folder === undefined) return;
    const next = new Set(expanded);
    if (open) next.add(folder);
    else next.delete(folder);
    setExpanded(next);
  };

  return (
    <Tree
      label="Places"
      rows={rows}
      selectedId={selectedRowId(place)}
      onSelect={(id) => {
        const target = places.get(id);
        if (target) setPlace(target);
      }}
      onExpand={(id) => setOpen(id, true)}
      onCollapse={(id) => setOpen(id, false)}
    />
  );
}

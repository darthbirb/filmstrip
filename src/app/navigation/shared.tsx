import type { FolderNode } from "../../ipc/bindings/FolderNode";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Glyph } from "../../ui/Glyph";
import type { TreeRow } from "../../ui/Tree";
import type { Crumb, Place } from "../place";

export const SORTING_ID = "sorting";
export const TRASH_ID = "trash";
export const folderRowId = (id: number) => `folder-${id}`;

export function libraries(sources: SourceSummary[]) {
  return sources.filter((source) => source.kind === "library");
}

export function sourcePlace(source: SourceSummary): Place {
  return {
    kind: "folder",
    sourceId: source.id,
    path: [{ id: source.rootFolderId, title: source.title }],
  };
}

/** The Sorting Box: every sorting source shown as one place, counted together. */
export function sortingRow(sources: SourceSummary[], onNominate?: () => void): TreeRow {
  const waiting = sources
    .filter((source) => source.kind === "sorting")
    .reduce((sum, source) => sum + source.itemCount, 0);
  return {
    id: SORTING_ID,
    label: "Sorting Box",
    level: 1,
    expandable: false,
    glyph: "sortingBox",
    count: waiting > 0 ? waiting : undefined,
    // Which + was pressed is what decides a source's kind, so this one is never hidden.
    action: onNominate
      ? { glyph: "plus", label: "Nominate a folder", onClick: onNominate }
      : undefined,
  };
}

export function trashRow(): TreeRow {
  return { id: TRASH_ID, label: "Trash", level: 1, expandable: false, glyph: "trash" };
}

/** A source's own row. One that cannot be read is muted and says so, but keeps its folders. */
export function sourceRow(source: SourceSummary, row: Partial<TreeRow> = {}): TreeRow {
  return {
    id: folderRowId(source.rootFolderId),
    label: source.title,
    level: 1,
    expandable: false,
    glyph: "source",
    detail: source.reachable ? undefined : "offline",
    muted: !source.reachable,
    ...row,
  };
}

type Walk = {
  children: ReadonlyMap<number, FolderNode[]>;
  expanded: ReadonlySet<number>;
  sourceId: number;
  rows: TreeRow[];
  places: Map<string, Place>;
};

/** A folder's subtree as rows, down through whichever folders are open. */
export function addFolderRows(walk: Walk, parent: Crumb[], level: number) {
  const parentId = parent.at(-1)?.id;
  if (parentId === undefined) return;
  for (const node of walk.children.get(parentId) ?? []) {
    const path = [...parent, { id: node.id, title: node.title }];
    const id = folderRowId(node.id);
    walk.rows.push({
      id,
      label: node.title,
      level,
      expandable: node.childCount > 0,
      expanded: walk.expanded.has(node.id),
      glyph: "folder",
      // Its own items, not the ones below it: the grid's header says both when both are wanted.
      count: node.itemCount > 0 ? node.itemCount : undefined,
    });
    walk.places.set(id, { kind: "folder", sourceId: walk.sourceId, path });
    if (walk.expanded.has(node.id)) addFolderRows(walk, path, level + 1);
  }
}

/** The row that stands for a place, in a tree that shows every folder. */
export function selectedRowId(place: Place | null) {
  if (!place) return null;
  if (place.kind === "sorting") return SORTING_ID;
  if (place.kind === "trash") return TRASH_ID;
  const folder = place.path.at(-1);
  return folder ? folderRowId(folder.id) : null;
}

/** The folder a row id names, if it names one. */
export function rowFolder(id: string) {
  return id.startsWith("folder-") ? Number(id.slice("folder-".length)) : undefined;
}

/** The doorway, where the tree will be. A folder is read where it stands, never moved. */
export function NoSources({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      glyph="folders"
      title="No Sources Yet"
      note="Add a folder and Filmstrip will read it where it stands."
    >
      <Button glyph="plus" onClick={onAdd}>
        Add a folder…
      </Button>
    </EmptyState>
  );
}

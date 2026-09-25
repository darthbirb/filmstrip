import type { FavouritePlace } from "../../ipc/bindings/FavouritePlace";
import type { FolderNode } from "../../ipc/bindings/FolderNode";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import type { TrashSummary } from "../../ipc/bindings/TrashSummary";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import type { TreeRow } from "../../ui/Tree";
import type { Crumb, Place } from "../place";

export const SORTING_ID = "sorting";
export const TRASH_ID = "trash";
export const folderRowId = (id: number) => `folder-${id}`;
export const favouriteRowId = (id: number) => `favourite-${id}`;

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
      ? { glyph: "plus", label: "Add Sorting Source…", onClick: onNominate }
      : undefined,
  };
}

/** The Trash, with the number of files waiting in it. */
export function trashRow(trash: TrashSummary | null = null): TreeRow {
  const count = trash && trash.count > 0 ? trash.count : undefined;
  return { id: TRASH_ID, label: "Trash", level: 1, expandable: false, glyph: "trash", count };
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

/** A folder New Folder is about to make: a row in its place, not yet on disk. */
export type Draft = { parent: number; title: string };

export const DRAFT_ID = "draft";

type Walk = {
  children: ReadonlyMap<number, FolderNode[]>;
  expanded: ReadonlySet<number>;
  sourceId: number;
  rows: TreeRow[];
  places: Map<string, Place>;
  draft?: Draft | null;
};

/** A folder's subtree as rows, down through whichever folders are open. */
export function addFolderRows(walk: Walk, parent: Crumb[], level: number) {
  const parentId = parent.at(-1)?.id;
  if (parentId === undefined) return;
  const nodes: (FolderNode | Draft)[] = [...(walk.children.get(parentId) ?? [])];
  // The draft lands where its name puts it, as the folder will once it is made.
  if (walk.draft?.parent === parentId) nodes.push(walk.draft);
  nodes.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  for (const node of nodes) {
    if (!("id" in node)) {
      walk.rows.push({
        id: DRAFT_ID,
        label: node.title,
        level,
        expandable: false,
        glyph: "folder",
      });
      continue;
    }
    const path = [...parent, { id: node.id, title: node.title }];
    const id = folderRowId(node.id);
    walk.rows.push({
      id,
      label: node.title,
      level,
      expandable: node.childCount > 0 || walk.draft?.parent === node.id,
      expanded: walk.expanded.has(node.id),
      glyph: "folder",
      // Its own items, not the ones below it: the grid's header says both when both are wanted.
      count: node.itemCount > 0 ? node.itemCount : undefined,
    });
    walk.places.set(id, { kind: "folder", sourceId: walk.sourceId, path });
    if (walk.expanded.has(node.id)) addFolderRows(walk, path, level + 1);
  }
}

/** The name a new folder starts with: the first of Windows' own that is free there. */
export function freshTitle(siblings: readonly FolderNode[]) {
  const held = new Set(siblings.map((one) => one.title.toLowerCase()));
  for (let n = 1; ; n++) {
    const title = n === 1 ? "New folder" : `New folder (${n})`;
    if (!held.has(title.toLowerCase())) return title;
  }
}

/**
 * A favourite place's row, in a group of its own between the app's places and the sources: a
 * filled star, its name, and the folder it is in; a source has none. DECISIONS.md "Navigation".
 */
export function favouriteRow(
  place: FavouritePlace,
  standing: Place | null,
  first: boolean,
): TreeRow {
  const own = place.path.at(-1);
  const source = place.path.length === 1;
  const here = standing?.kind === "folder" && standing.path.at(-1)?.id === place.folderId;
  return {
    id: favouriteRowId(place.folderId),
    label: own?.title ?? "",
    level: 1,
    expandable: false,
    glyph: "star",
    note: source ? undefined : place.path.at(-2)?.title,
    // A source counts itself whole, so its row has no pill here either.
    count: !source && place.itemCount > 0 ? place.itemCount : undefined,
    detail: place.reachable ? undefined : "offline",
    muted: !place.reachable,
    separated: first,
    here,
  };
}

/** Where a favourite place's row goes. */
export function favouritePlace(place: FavouritePlace): Place {
  return { kind: "folder", sourceId: place.sourceId, path: place.path };
}

/** The row that stands for a place, in a tree that shows every folder. */
export function selectedRowId(place: Place | null) {
  if (!place) return null;
  if (place.kind === "sorting") return SORTING_ID;
  if (place.kind === "trash") return TRASH_ID;
  const folder = place.path.at(-1);
  return folder ? folderRowId(folder.id) : null;
}

/** The folder a row id names, if it names one: its own row, or its favourite's. */
export function rowFolder(id: string) {
  for (const prefix of ["folder-", "favourite-"]) {
    if (id.startsWith(prefix)) return Number(id.slice(prefix.length));
  }
  return undefined;
}

/** The doorway, where the tree will be. A folder is read where it stands, never moved. */
export function NoSources({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState glyph="folders" title="No Sources Yet">
      <Button glyph="plus" onClick={onAdd}>
        Add Source…
      </Button>
    </EmptyState>
  );
}

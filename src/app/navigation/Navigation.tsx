import { useEffect, useState } from "react";

import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { readFolderAgain, renameSource, revealFolder, revealSource } from "../../ipc/commands";
import type { HeadedMenu, MenuAction, MenuGroups } from "../../ui/Menu";
import { Tree, type TreeRow } from "../../ui/Tree";
import { type Place, setPlace, usePlace } from "../place";
import { openSettings } from "../settings/settings-store";
import { addFolder } from "./add-source";
import { ensureChildren, loadIndex, useIndex } from "./index-store";
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
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    ensureChildren([...expanded]);
  }, [expanded]);

  if (!sources) return null;
  if (sources.length === 0) return <NoSources onAdd={() => void addFolder("library")} />;

  const rows: TreeRow[] = [sortingRow(sources, () => void addFolder("sorting")), trashRow()];
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

  const sourceOf = (id: string) => {
    const at = places.get(id);
    if (at?.kind !== "folder") return undefined;
    return sources.find((source) => source.id === at.sourceId);
  };

  const menuFor = (id: string): HeadedMenu => {
    const source = sourceOf(id);
    const folder = rowFolder(id);
    if (!source || folder === undefined) return { groups: [] };
    if (folder === source.rootFolderId) {
      return { heading: "Source", groups: sourceMenu(source, () => setRenaming(id)) };
    }
    // Neither can act on a folder whose drive is away, and an empty menu opens nothing.
    return { groups: source.reachable ? [[revealFolderRow(folder), readAgainRow(folder)]] : [] };
  };

  const renamed = sourceOf(renaming ?? "");
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
      menuFor={menuFor}
      renaming={
        renaming && renamed
          ? {
              id: renaming,
              onCommit: (name) => {
                setRenaming(null);
                void renameSource(renamed.id, name)
                  .then(() => loadIndex())
                  .catch(() => undefined);
              },
              onCancel: () => setRenaming(null),
            }
          : null
      }
    />
  );
}

/**
 * A source's row: the verbs a folder's row has that a source can take, then the two that only a
 * source has, which point at the Sources section rather than holding anything of their own.
 * DECISIONS.md "Right-click menus".
 */
function sourceMenu(source: SourceSummary, rename: () => void): MenuGroups {
  const folder = source.rootFolderId;
  const reveal: MenuAction = {
    id: "reveal",
    label: "Show in Explorer",
    glyph: "folderOpen",
    onSelect: () => void revealSource(source.id).catch(() => undefined),
  };
  const naming: MenuAction = { id: "rename", label: "Rename", glyph: "rename", onSelect: rename };
  return [
    source.reachable ? [reveal, naming, readAgainRow(folder)] : [naming],
    [
      {
        id: "manage",
        label: "Manage Sources",
        glyph: "settings",
        onSelect: () => openSettings({ section: "sources" }),
      },
      {
        id: "remove",
        label: "Remove Source",
        glyph: "minusCircle",
        tone: "danger",
        onSelect: () => openSettings({ section: "sources", asking: source.id }),
      },
    ],
  ];
}

function revealFolderRow(folder: number): MenuAction {
  return {
    id: "reveal",
    label: "Show in Explorer",
    glyph: "folderOpen",
    onSelect: () => void revealFolder(folder).catch(() => undefined),
  };
}

function readAgainRow(folder: number): MenuAction {
  return {
    id: "read-again",
    label: "Refresh",
    glyph: "readAgain",
    onSelect: () => void readFolderAgain(folder).catch(() => undefined),
  };
}

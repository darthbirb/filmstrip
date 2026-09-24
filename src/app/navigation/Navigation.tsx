import { useEffect, useState } from "react";

import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import {
  readFolderAgain,
  renameFolder,
  renameSource,
  revealFolder,
  revealSource,
} from "../../ipc/commands";
import type { HeadedMenu, MenuAction, MenuGroups } from "../../ui/Menu";
import { Tree, type TreeRow } from "../../ui/Tree";
import { libraryChanged } from "../library";
import { type Place, setPlace, usePlace } from "../place";
import { openSettings } from "../settings/settings-store";
import { refusedName } from "../undo/lines";
import { afterAct } from "../undo/undo";
import { addFolder } from "./add-source";
import { ensureChildren, loadIndex, useIndex } from "./index-store";
import { setOpenFolders, useOpenFolders } from "./open-folders";
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
  const expanded = useOpenFolders();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);

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
    setOpenFolders(next);
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
    const rename = () => {
      setTaken(null);
      setRenaming(id);
    };
    if (folder === source.rootFolderId) {
      return { heading: "Source", groups: sourceMenu(source, rename) };
    }
    // Nothing on it can act on a folder whose drive is away, and an empty menu opens nothing.
    if (!source.reachable) return { groups: [] };
    return { groups: [[], [revealFolderRow(folder), renameRow(rename), readAgainRow(folder)]] };
  };

  const stopRenaming = () => {
    setRenaming(null);
    setTaken(null);
  };
  // A source's name is the app's own label; a folder's is its directory's, so it can be taken.
  const rename = async (id: string, name: string) => {
    const source = sourceOf(id);
    const folder = rowFolder(id);
    if (!source || folder === undefined) return stopRenaming();
    if (folder === source.rootFolderId) {
      stopRenaming();
      await renameSource(source.id, name).catch(() => undefined);
      await loadIndex().catch(() => undefined);
      return;
    }
    try {
      const batch = await renameFolder(folder, name);
      if (batch) afterAct(batch);
      await libraryChanged();
      stopRenaming();
    } catch (error) {
      const refused = refusedName(error);
      if (refused) setTaken(refused);
      else stopRenaming();
    }
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
      menuFor={menuFor}
      renaming={
        renaming
          ? {
              id: renaming,
              onCommit: (name) => void rename(renaming, name),
              onCancel: stopRenaming,
              taken,
              onEdit: () => setTaken(null),
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
  const naming = renameRow(rename);
  return [
    [],
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

function renameRow(rename: () => void): MenuAction {
  return { id: "rename", label: "Rename", glyph: "rename", onSelect: rename };
}

function readAgainRow(folder: number): MenuAction {
  return {
    id: "read-again",
    label: "Refresh",
    glyph: "readAgain",
    onSelect: () => void readFolderAgain(folder).catch(() => undefined),
  };
}

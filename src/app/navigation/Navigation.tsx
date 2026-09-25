import { useEffect, useRef, useState } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import {
  createFolder,
  readFolderAgain,
  renameFolder,
  renameSource,
  revealFolder,
  revealSource,
  setFolderFavorite,
} from "../../ipc/commands";
import type { HeadedMenu, MenuAction, MenuGroups } from "../../ui/Menu";
import { Tree, type TreeRow } from "../../ui/Tree";
import { type Landing, type Resolver, setDropResolver, useDrag } from "../grid/drag";
import { libraryChanged } from "../library";
import { openMovePicker } from "../pane/move-picker";
import { type Place, setPlace, usePlace } from "../place";
import { openSettings } from "../settings/settings-store";
import { refusedName } from "../undo/lines";
import { afterAct } from "../undo/undo";
import { addFolder } from "./add-source";
import { deleteFolderAsking } from "./delete-folder";
import { ensureChildren, loadIndex, refreshIndex, useIndex } from "./index-store";
import { openFolders, setOpenFolders, useOpenFolders } from "./open-folders";
import {
  addFolderRows,
  DRAFT_ID,
  type Draft,
  favouritePlace,
  favouriteRow,
  freshTitle,
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
  const { sources, children, trash, favourites } = useIndex();
  const place = usePlace();
  const expanded = useOpenFolders();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const drag = useDrag();

  useEffect(() => {
    ensureChildren([...expanded]);
  }, [expanded]);

  // A drop is answered by the rows of the newest render, and by none while there is no tree.
  const landing = useRef<Resolver>(() => null);
  landing.current = () => null;
  useEffect(() => {
    setDropResolver((id, carried) => landing.current(id, carried));
    return () => setDropResolver(() => null);
  }, []);

  if (!sources) return null;
  if (sources.length === 0) return <NoSources onAdd={() => void addFolder("library")} />;

  const rows: TreeRow[] = [sortingRow(sources, () => void addFolder("sorting")), trashRow(trash)];
  const places = new Map<string, Place>([
    [SORTING_ID, { kind: "sorting" }],
    [TRASH_ID, { kind: "trash" }],
  ]);
  // Their own group, between the app's places and the sources, a rule either side of it.
  favourites.forEach((favourite, index) => {
    const row = favouriteRow(favourite, place, index === 0);
    rows.push(row);
    places.set(row.id, favouritePlace(favourite));
  });
  libraries(sources).forEach((source, index) => {
    const root = source.rootFolderId;
    const row = sourceRow(source, {
      expandable: (children.get(root)?.length ?? 0) > 0 || draft?.parent === root,
      expanded: expanded.has(root),
      separated: index === 0,
    });
    rows.push(row);
    const at = sourcePlace(source);
    places.set(row.id, at);
    if (expanded.has(root) && at.kind === "folder") {
      const walk = { children, expanded, sourceId: source.id, rows, places, draft };
      addFolderRows(walk, at.path, 2);
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

  /**
   * What a row does with files dropped on it: a folder, a source or a favourite takes them, but
   * not the files' own folder, not the Trash, not a drive that is away, and the Sorting Box only
   * when it is one folder. Artboards › Dragging onto a folder.
   */
  const landingFor = (id: string, carried: readonly ItemRow[]): Landing | null => {
    const refuse = (why: string): Landing => ({ kind: "refuse", why });
    const into = (folder: number, title: string, source: SourceSummary): Landing => {
      if (!source.reachable) return refuse(`${source.title} is offline`);
      if (carried.every((file) => file.folderId === folder)) return refuse(`Already in ${title}`);
      const row = rows.find((one) => one.id === id);
      const open = row?.expandable && !row.expanded ? () => setOpen(id, true) : undefined;
      return { kind: "accept", to: { id: folder, title }, open };
    };
    if (id === TRASH_ID) return refuse("Delete sends to the Trash");
    if (id === SORTING_ID) {
      const sorting = sources.filter((source) => source.kind === "sorting");
      const [one] = sorting;
      if (sorting.length > 1) return refuse("Use Move to… to pick one");
      return one ? into(one.rootFolderId, one.title, one) : null;
    }
    const folder = rowFolder(id);
    const source = sourceOf(id);
    const title = placeFolderPath(places.get(id)).at(-1)?.title;
    if (folder === undefined || !source || title === undefined) return null;
    return into(folder, title, source);
  };

  landing.current = landingFor;

  const menuFor = (id: string): HeadedMenu => {
    const source = sourceOf(id);
    const folder = rowFolder(id);
    if (!source || folder === undefined) return { groups: [] };
    const rename = () => {
      setTaken(null);
      setDraft(null);
      setRenaming(id);
    };
    const path = placeFolderPath(places.get(id));
    // The parent opens if it was shut, down from its source, and the row arrives in its field.
    const newFolder: MenuAction = {
      id: "new-folder",
      label: "New Folder",
      glyph: "newFolder",
      onSelect: () => {
        setTaken(null);
        setDraft({ parent: folder, title: freshTitle(children.get(folder) ?? []) });
        setRenaming(DRAFT_ID);
        openFolders(path.map((crumb) => crumb.id));
      },
    };
    // A favourite changes nothing on disk, so it is there whether the drive is or not.
    const favourite = favourites.some((one) => one.folderId === folder);
    const star: MenuAction = {
      id: "favourite",
      label: favourite ? "Remove Favourite" : "Favourite",
      glyph: "star",
      filled: favourite,
      onSelect: () =>
        void setFolderFavorite(folder, !favourite)
          .then(() => refreshIndex())
          .catch(() => undefined),
    };
    if (folder === source.rootFolderId) {
      return { heading: "Source", groups: sourceMenu(source, rename, newFolder, star) };
    }
    // Nothing on it can act on a folder whose drive is away, and an empty menu opens nothing.
    if (!source.reachable) return { groups: [] };
    const moveTo: MenuAction = {
      id: "move",
      label: "Move to…",
      glyph: "moveTo",
      // The menu has handed the focus back by now, so the picker opens against the row.
      onSelect: () => {
        const [name, parent] = [path.at(-1)?.title ?? "", path.at(-2)?.id ?? folder];
        const element = document.activeElement;
        const anchor = element instanceof HTMLElement ? { element } : { x: 0, y: 0 };
        openMovePicker({ folder: { id: folder, name }, folderId: parent, anchor });
      },
    };
    const remove: MenuAction = {
      id: "delete",
      label: "Delete",
      glyph: "trash",
      tone: "danger",
      onSelect: () =>
        void deleteFolderAsking({ id: folder, name: path.at(-1)?.title ?? "" }, sources),
    };
    return {
      groups: [
        [newFolder, star, moveTo],
        [revealFolderRow(folder), renameRow(rename), readAgainRow(folder)],
        [remove],
      ],
    };
  };

  const stopRenaming = () => {
    setRenaming(null);
    setTaken(null);
    setDraft(null);
  };

  // Nothing is on disk until the name is given; a name already there is said under the row.
  const make = async (made: Draft, name: string) => {
    try {
      const { batch } = await createFolder(made.parent, name);
      afterAct(batch);
      await libraryChanged();
      stopRenaming();
    } catch (error) {
      const refused = refusedName(error);
      if (refused) setTaken(refused);
      else stopRenaming();
    }
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
      accepting={drag?.over?.landing.kind === "accept" ? drag.over.rowId : null}
      renaming={
        renaming
          ? {
              id: renaming,
              onCommit: (name) => void (draft ? make(draft, name) : rename(renaming, name)),
              fresh: draft !== null,
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
function sourceMenu(
  source: SourceSummary,
  rename: () => void,
  newFolder: MenuAction,
  star: MenuAction,
): MenuGroups {
  const folder = source.rootFolderId;
  const reveal: MenuAction = {
    id: "reveal",
    label: "Show in Explorer",
    glyph: "folderOpen",
    onSelect: () => void revealSource(source.id).catch(() => undefined),
  };
  const naming = renameRow(rename);
  // New Folder is on it because a source's row is the only row that stands for its top level.
  return [
    source.reachable ? [newFolder, star] : [star],
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

const placeFolderPath = (place: Place | undefined) => (place?.kind === "folder" ? place.path : []);

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

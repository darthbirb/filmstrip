import { useEffect, useRef, useState } from "react";

import type { DestinationKey } from "../../ipc/bindings/DestinationKey";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import {
  createFolder,
  readFolderAgain,
  removeDestinationKey,
  renameFolder,
  renameSource,
  revealFolder,
  revealSource,
  setDestinationKey,
  setFolderFavorite,
} from "../../ipc/commands";
import { pathTerm } from "../../lib/queryTerm";
import {
  ContextMenu,
  type HeadedMenu,
  type MenuAction,
  type MenuAnchor,
  type MenuGroups,
} from "../../ui/Menu";
import { Tree, type TreeRow } from "../../ui/Tree";
import { exportFiles } from "../export/export";
import { type Landing, type Resolver, setDropResolver, useDrag } from "../grid/drag";
import { type CheckedFile, checkBranch } from "../grid/selection";
import { DIGITS } from "../keys";
import { libraryChanged } from "../library";
import { type Against, fromFocus, type PlaceMenu, setPlaceMenu } from "../menus/ground";
import { openMovePicker } from "../pane/move-picker";
import { showFolderInPane } from "../pane/pane-store";
import { counted, getClipboard } from "../paste/clipboard";
import { openPick, pasteInto, sortingPlaces } from "../paste/copy";
import {
  landingInto,
  type Landing as OutsideLanding,
  setOutsideResolver,
  sortingLanding,
  useOutsideDrag,
} from "../paste/drop";
import { type Place, placeFolder, setPlace, usePlace } from "../place";
import { searchIn } from "../search/SearchField";
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
  folderRowId,
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
  const { sources, children, totals, favourites, keys } = useIndex();
  const [keying, setKeying] = useState<Keying | null>(null);
  const place = usePlace();
  const expanded = useOpenFolders();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const drag = useDrag();
  const outside = useOutsideDrag();

  useEffect(() => {
    ensureChildren([...expanded]);
  }, [expanded]);

  // A drop is answered by the rows of the newest render, and by none while there is no tree.
  const landing = useRef<Resolver>(() => null);
  landing.current = () => null;
  const landingOutside = useRef<(id: string, paths: readonly string[]) => OutsideLanding | null>(
    () => null,
  );
  landingOutside.current = () => null;
  const ground = useRef<PlaceMenu>(() => ({ groups: [] }));
  ground.current = () => ({ groups: [] });
  // A menu built at one render can run at a later one, by which time the tree may have shut.
  const drawn = useRef<readonly TreeRow[]>([]);
  useEffect(() => {
    setDropResolver((id, carried) => landing.current(id, carried));
    setOutsideResolver((id, paths) => landingOutside.current(id, paths));
    setPlaceMenu((place, against) => ground.current(place, against));
    return () => {
      setDropResolver(() => null);
      setOutsideResolver(() => null);
      setPlaceMenu(() => ({ groups: [] }));
    };
  }, []);

  if (!sources) return null;
  if (sources.length === 0) return <NoSources onAdd={() => void addFolder("library")} />;

  const rows: TreeRow[] = [
    sortingRow(sources, () => void addFolder("sorting")),
    trashRow(totals?.trash),
  ];
  drawn.current = rows;
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

  // A bound folder's rows carry its key, wherever the folder shows: its own row and its favourite.
  const keyOf = new Map(keys.filter((one) => !one.gone).map((one) => [one.folderId, one.key]));
  for (const row of rows) {
    const folder = rowFolder(row.id);
    const key = folder === undefined ? undefined : keyOf.get(folder);
    if (key !== undefined) row.key = key;
  }

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
  const landingFor = (id: string, carried: readonly CheckedFile[]): Landing | null => {
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

  /**
   * What a row does with files from Explorer: as for a move, a folder, a source or a favourite takes
   * them, the Trash never does, and the Sorting Box asks which source when it has more than one.
   * Artboards › Bringing files in.
   */
  landingOutside.current = (id, paths) => {
    if (id === TRASH_ID) return { kind: "refuse", why: "Only Delete sends to the Trash" };
    if (id === SORTING_ID) return sortingLanding(sources, paths);
    const source = sourceOf(id);
    const at = places.get(id);
    if (!source || at?.kind !== "folder") return null;
    const row = rows.find((one) => one.id === id);
    const open = row?.expandable && !row.expanded ? () => setOpen(id, true) : undefined;
    return landingInto(source, at.path, paths, open);
  };

  /** The Sorting Box's own menu: Paste alone, and only while the clipboard holds files. */
  const sortingMenu = (against: Against): HeadedMenu => {
    const held = getClipboard();
    const boxes = sortingPlaces(sources);
    const [one] = boxes;
    if (!held || !one) return { groups: [] };
    const what = counted(held, true);
    if (boxes.length === 1) {
      return {
        groups: [
          [
            {
              id: "paste",
              label: `Paste ${what}`,
              glyph: "paste",
              onSelect: () => void pasteInto(one),
            },
          ],
        ],
      };
    }
    // The pick takes the menu's place, against what it was opened on.
    const ask = () => {
      openPick({
        heading: `Paste ${what} Into`,
        anchor: against.anchor(),
        places: boxes,
        onPick: (to) => void pasteInto(to),
      });
    };
    return { groups: [[{ id: "paste", label: `Paste ${what}…`, glyph: "paste", onSelect: ask }]] };
  };

  /** A place's menu, on its row `id` or on the grid's ground, whose verbs open `against` it. */
  const menuAt = (id: string, place: Place | undefined, against: Against): HeadedMenu => {
    if (place?.kind === "sorting") return sortingMenu(against);
    const path = placeFolderPath(place);
    const source =
      place?.kind === "folder" ? sources.find((one) => one.id === place.sourceId) : undefined;
    const folder = path.at(-1)?.id;
    if (!place || !source || folder === undefined) return { groups: [] };
    // From the ground the row may be inside a folder that is shut, so its parents open first.
    const rename = () => {
      setTaken(null);
      setDraft(null);
      if (!drawn.current.some((row) => row.id === id))
        openFolders(path.slice(0, -1).map((crumb) => crumb.id));
      setRenaming(id);
    };
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
    // Read when the menu opens; with no files on the clipboard the row is absent.
    const held = getClipboard();
    const pasteHere: MenuAction[] = held
      ? [
          {
            id: "paste",
            label: `Paste ${counted(held, true)}`,
            glyph: "paste",
            onSelect: () =>
              void pasteInto({ id: folder, title: path.at(-1)?.title ?? source.title }),
          },
        ]
      : [];
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
    if (source.kind === "sorting") return { groups: [[...pasteHere, star]] };
    // It only looks, as Full Screen heads a tile's menu; the pane reads the index, so offline too.
    const showInPane: MenuAction = {
      id: "show-in-pane",
      label: "Show in Pane",
      glyph: "panel",
      flip: true,
      onSelect: () => showFolderInPane(folder, source.id),
    };
    const title = path.at(-1)?.title ?? source.title;
    const assign: MenuAction = {
      id: "assign-key",
      label: "Assign Key…",
      glyph: "keyboard",
      trail: keyOf.get(folder),
      onSelect: () => setKeying({ folder, title, anchor: against.anchor() }),
    };
    // Ctrl+F with the offer taken, for a place you are not in: the scope is written, nothing runs.
    const titles = path.length > 0 ? path.map((crumb) => crumb.title) : [source.title];
    const searchHere = (label: string): MenuAction => ({
      id: "search",
      label,
      glyph: "search",
      onSelect: () => searchIn(pathTerm(titles)),
    });
    const inside: MenuAction = {
      id: "select-inside",
      label: "Select Everything Inside",
      glyph: "checkAll",
      onSelect: () => {
        setPlace(place);
        void checkBranch().catch(() => undefined);
      },
    };
    const exportHere: MenuAction = {
      id: "export",
      label: "Export…",
      glyph: "zip",
      onSelect: () => {
        const anchor = against.sheet();
        void exportFiles({
          scope: { kind: "branch", folderId: folder },
          name: title,
          folder: title,
          anchor: () => (anchor?.isConnected ? anchor : null),
          below: true,
        });
      },
    };
    if (folder === source.rootFolderId) {
      const search = searchHere("Search in Source");
      return {
        heading: "Source",
        groups: sourceMenu(
          source,
          rename,
          { showInPane, newFolder, star, assign, search, inside, exportHere },
          pasteHere,
        ),
      };
    }
    // A folder whose drive is away keeps what only the index holds, as its source's row does.
    if (!source.reachable) return { groups: [[showInPane, star, assign], [inside]] };
    const moveTo: MenuAction = {
      id: "move",
      label: "Move to…",
      glyph: "moveTo",
      onSelect: () => {
        const [name, parent] = [path.at(-1)?.title ?? "", path.at(-2)?.id ?? folder];
        openMovePicker({
          folder: { id: folder, name },
          folderId: parent,
          anchor: against.anchor(),
        });
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
        [showInPane, newFolder, ...pasteHere, star, assign, moveTo],
        [
          searchHere("Search in Folder"),
          inside,
          revealFolderRow(folder),
          exportHere,
          renameRow(rename),
          readAgainRow(folder),
        ],
        [remove],
      ],
    };
  };

  const menuFor = (id: string) => menuAt(id, places.get(id), fromFocus);

  // Its row's menu under its name, since it is not on its row; what it opens, opens where it was.
  ground.current = (place, against) => {
    if (place.kind === "sorting") {
      return { heading: "Sorting Box", groups: sortingMenu(against).groups };
    }
    const folder = placeFolder(place);
    if (!folder) return { groups: [] };
    return { heading: folder.title, groups: menuAt(folderRowId(folder.id), place, against).groups };
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
    <>
      {keying && (
        <ContextMenu
          label={`Key for ${keying.title}`}
          heading={`Key for ${keying.title}`}
          groups={keyGroups(keys, keying.folder)}
          anchor={keying.anchor}
          onClose={() => setKeying(null)}
        />
      )}
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
        accepting={
          drag?.over?.landing.kind === "accept"
            ? drag.over.rowId
            : outside?.over && outside.over.landing.kind !== "refuse"
              ? outside.over.rowId
              : null
        }
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
    </>
  );
}

/** A folder the key menu is open for, and the row it opened against. */
type Keying = { folder: number; title: string; anchor: MenuAnchor };

/**
 * The ten keys, each with the folder it is on, this folder's own on the plate, then No Key.
 * Picking a key another folder holds moves it, with no question. Artboards › Destination keys.
 */
function keyGroups(keys: readonly DestinationKey[], folder: number): MenuGroups {
  const own = keys.find((one) => one.folderId === folder);
  const bind = (work: Promise<void>) => void work.then(() => refreshIndex()).catch(() => undefined);
  const digits: MenuAction[] = DIGITS.map((digit) => {
    const held = keys.find((one) => one.key === digit);
    const name = held?.path.at(-1)?.title;
    return {
      id: `key-${digit}`,
      label: !held ? "Free" : held.gone ? `${name} · gone` : (name ?? ""),
      chip: digit,
      chosen: held?.folderId === folder,
      quiet: !held || held.gone,
      onSelect: () => bind(setDestinationKey(digit, folder)),
    };
  });
  const none: MenuAction = {
    id: "no-key",
    label: "No Key",
    glyph: "close",
    onSelect: () => {
      if (own) bind(removeDestinationKey(own.key));
    },
  };
  return [digits, [none]];
}

/**
 * A source's row: the verbs a folder's row has that a source can take, then the two that only a
 * source has, which point at the Sources section rather than holding anything of their own.
 * DECISIONS.md "Right-click menus".
 */
function sourceMenu(
  source: SourceSummary,
  rename: () => void,
  rows: Record<
    "showInPane" | "newFolder" | "star" | "assign" | "search" | "inside" | "exportHere",
    MenuAction
  >,
  paste: readonly MenuAction[],
): MenuGroups {
  const { showInPane, newFolder, star, assign, search, inside, exportHere } = rows;
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
    source.reachable ? [showInPane, newFolder, ...paste, star, assign] : [showInPane, star, assign],
    source.reachable
      ? [search, inside, reveal, exportHere, naming, readAgainRow(folder)]
      : [inside, naming],
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

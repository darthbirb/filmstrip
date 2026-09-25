import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import type { DestinationKey } from "../../ipc/bindings/DestinationKey";
import type { FavouritePlace } from "../../ipc/bindings/FavouritePlace";
import type { FolderEntry } from "../../ipc/bindings/FolderEntry";
import type { FolderNode } from "../../ipc/bindings/FolderNode";
import type { Progress } from "../../ipc/bindings/Progress";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import type { TrashSummary } from "../../ipc/bindings/TrashSummary";
import {
  destinationKeys,
  favouritePlaces,
  folderChildren,
  listFolders,
  listSources,
  trashSummary,
} from "../../ipc/commands";
import { getPaneOrigin, movePaneOrigin, showInPane } from "../pane/pane-store";
import { type Crumb, getPlace, type Place, setPlace } from "../place";
import { openFolders, setOpenFolders } from "./open-folders";

/**
 * The index as navigation reads it: the sources, each folder's children once asked for, how much
 * the Trash holds, the favourite places, and the destination keys.
 */
type Snapshot = {
  sources: SourceSummary[] | null;
  children: ReadonlyMap<number, FolderNode[]>;
  trash: TrashSummary | null;
  favourites: FavouritePlace[];
  keys: DestinationKey[];
};

const EMPTY: Snapshot = {
  sources: null,
  children: new Map(),
  trash: null,
  favourites: [],
  keys: [],
};
let snapshot: Snapshot = EMPTY;
const pending = new Set<number>();
const listeners = new Set<() => void>();

/** Reads the sources and their top-level folders, then settles where the window is looking. */
export async function loadIndex() {
  const [sources, trash, favourites, keys] = await Promise.all([
    listSources(),
    trashSummary().catch(() => null),
    favouritePlaces().catch(() => []),
    destinationKeys().catch(() => []),
  ]);
  publish({ sources, children: new Map(), trash, favourites, keys });
  ensureChildren(sources.map((source) => source.rootFolderId));
  await settle(sources);
}

/**
 * A place follows its folder: moved, it goes with it, opened down to; gone, it is the nearest
 * folder above it still there; and with its source gone it is left, so nothing waits on a folder
 * that no longer exists. Then an empty window settles on the first library. DECISIONS.md "Places, not queries".
 */
async function settle(sources: SourceSummary[]) {
  const folders = await listFolders().catch(() => null);
  const held = (place: Place | null) =>
    place?.kind !== "folder" || sources.some((source) => source.id === place.sourceId);
  const now = (place: Place | null) =>
    folders ? follow(place, folders) : held(place) ? place : null;

  const place = getPlace();
  const here = now(place);
  if (here !== place) {
    setPlace(here);
    const moved = here?.kind === "folder" && place?.kind === "folder" && !samePlace(place, here);
    if (moved) openFolders(here.path.slice(0, -1).map((crumb) => crumb.id));
  }
  // The pane's file went with a folder that went, so the pane has nothing left to show.
  const origin = getPaneOrigin();
  const from = now(origin);
  if (origin !== null && (from === null || leaf(from) !== leaf(origin))) showInPane(null);
  else if (from && from !== origin) movePaneOrigin(from);

  const library = sources.find((source) => source.kind === "library");
  if (getPlace() === null && library) {
    setPlace({
      kind: "folder",
      sourceId: library.id,
      path: [{ id: library.rootFolderId, title: library.title }],
    });
  }
}

/** Loads what is indexed, and again each time the background work goes quiet. */
export async function startIndex() {
  await loadIndex().catch(() => undefined);
  await listen<Progress>("job-progress", (event) => {
    if (event.payload.phase === "idle") void loadIndex().catch(() => undefined);
  }).catch(() => undefined);
}

export function useIndex() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/**
 * Reads the sources and every folder already known again, after the app itself changed the disk,
 * so what is open stays open and every count is current.
 */
export async function refreshIndex() {
  const known = [...snapshot.children.keys()];
  const [sources, lists, trash, favourites, keys] = await Promise.all([
    listSources(),
    Promise.all(known.map((id) => folderChildren(id).catch(() => null))),
    trashSummary().catch(() => null),
    favouritePlaces().catch(() => []),
    destinationKeys().catch(() => []),
  ]);
  const children = new Map<number, FolderNode[]>();
  known.forEach((id, at) => {
    const list = lists[at];
    if (list) children.set(id, list);
  });
  publish({ sources, children, trash, favourites, keys });
  await settle(sources);
}

/** Where a place is now, read off every live folder; the same object when nothing changed. */
function follow(place: Place | null, folders: readonly FolderEntry[]): Place | null {
  if (place?.kind !== "folder") return place;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const crumb of [...place.path].reverse()) {
    const found = byId.get(crumb.id);
    if (!found) continue;
    const path: Crumb[] = [];
    for (let at: FolderEntry | undefined = found; at; ) {
      path.unshift({ id: at.id, title: at.title });
      at = at.parentId === null ? undefined : byId.get(at.parentId);
    }
    const next: Place = { kind: "folder", sourceId: found.sourceId, path };
    return sameCrumbs(place.path, path) ? place : next;
  }
  return null;
}

const leaf = (place: Place) => (place.kind === "folder" ? place.path.at(-1)?.id : place.kind);

/** The same folders, whatever they are called now. */
function samePlace(a: Place & { kind: "folder" }, b: Place & { kind: "folder" }) {
  return a.path.map((crumb) => crumb.id).join() === b.path.map((crumb) => crumb.id).join();
}

function sameCrumbs(a: readonly Crumb[], b: readonly Crumb[]) {
  return (
    a.length === b.length &&
    a.every((crumb, at) => crumb.id === b[at]?.id && crumb.title === b[at]?.title)
  );
}

/** Asks for any of these folders' children not yet known. */
export function ensureChildren(folderIds: number[]) {
  for (const id of folderIds) {
    if (snapshot.children.has(id) || pending.has(id)) continue;
    pending.add(id);
    folderChildren(id)
      .then((list) => {
        const children = new Map(snapshot.children);
        children.set(id, list);
        publish({ ...snapshot, children });
      })
      .catch(() => undefined)
      .finally(() => pending.delete(id));
  }
}

/** Forgets everything, for tests. */
export function resetIndex() {
  pending.clear();
  setOpenFolders(new Set());
  publish(EMPTY);
}

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

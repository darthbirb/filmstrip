import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import type { FolderNode } from "../../ipc/bindings/FolderNode";
import type { Progress } from "../../ipc/bindings/Progress";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { folderChildren, listSources } from "../../ipc/commands";
import { getPaneOrigin, showInPane } from "../pane/pane-store";
import { getPlace, type Place, setPlace } from "../place";

/** The index as navigation reads it: the sources, and each folder's children once asked for. */
type Snapshot = {
  sources: SourceSummary[] | null;
  children: ReadonlyMap<number, FolderNode[]>;
};

let snapshot: Snapshot = { sources: null, children: new Map() };
const pending = new Set<number>();
const listeners = new Set<() => void>();

/** Reads the sources and their top-level folders, then settles where the window is looking. */
export async function loadIndex() {
  const sources = await listSources();
  publish({ sources, children: new Map() });
  ensureChildren(sources.map((source) => source.rootFolderId));
  settle(sources);
}

/**
 * A source that is gone is left rather than stood in, so nothing waits on a folder that no
 * longer exists; then an empty window settles on the first library. DECISIONS.md "Places, not queries".
 */
function settle(sources: SourceSummary[]) {
  const held = (place: Place | null) =>
    place?.kind !== "folder" || sources.some((source) => source.id === place.sourceId);
  if (!held(getPlace())) setPlace(null);
  if (!held(getPaneOrigin())) showInPane(null);
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
  publish({ sources: null, children: new Map() });
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

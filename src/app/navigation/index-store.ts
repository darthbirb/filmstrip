import { useSyncExternalStore } from "react";

import type { FolderNode } from "../../ipc/bindings/FolderNode";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { folderChildren, listSources, reconcile } from "../../ipc/commands";
import { getPlace, setPlace } from "../place";

/** The index as navigation reads it: the sources, and each folder's children once asked for. */
type Snapshot = {
  sources: SourceSummary[] | null;
  children: ReadonlyMap<number, FolderNode[]>;
};

let snapshot: Snapshot = { sources: null, children: new Map() };
const pending = new Set<number>();
const listeners = new Set<() => void>();

/** Reads the sources and their top-level folders, and settles on a place if there is none. */
export async function loadIndex() {
  const sources = await listSources();
  publish({ sources, children: new Map() });
  ensureChildren(sources.map((source) => source.rootFolderId));
  const library = sources.find((source) => source.kind === "library");
  if (getPlace() === null && library) {
    setPlace({
      kind: "folder",
      sourceId: library.id,
      path: [{ id: library.rootFolderId, title: library.title }],
    });
  }
}

/** Loads what is indexed, then walks every source and loads again, so the disk has the last word. */
export async function startIndex() {
  await loadIndex().catch(() => undefined);
  await reconcile().catch(() => undefined);
  await loadIndex().catch(() => undefined);
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

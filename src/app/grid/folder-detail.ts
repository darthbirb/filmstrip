import { useEffect, useState, useSyncExternalStore } from "react";

import type { FolderDetail } from "../../ipc/bindings/FolderDetail";
import { folderDetail } from "../../ipc/commands";
import { useIndex } from "../navigation/index-store";
import type { Crumb } from "../place";

// Whether the band is open, for the whole session and whichever folder is shown: a person who
// opened it once wants it on the next folder too. DECISIONS.md "A folder's details".
let open = false;
// Read again after anything that changes what a folder knows about itself.
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBandOpen() {
  return useSyncExternalStore(subscribe, () => open);
}

export function setBandOpen(next: boolean) {
  open = next;
  changed();
}

/** Asks every band to read its folder again. */
export function detailChanged() {
  version += 1;
  changed();
}

/** A count that moves each time what a folder knows about itself changes. */
export function useDetailVersion() {
  return useSyncExternalStore(subscribe, () => version);
}

/** A folder's details, read again whenever the index or the folder itself changes. */
export function useFolderDetail(folderId: number | null) {
  const { sources } = useIndex();
  const read = useSyncExternalStore(subscribe, () => version);
  const [found, setFound] = useState<FolderDetail | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the index and the version are when to read again.
  useEffect(() => {
    if (folderId === null) return;
    let live = true;
    folderDetail(folderId)
      .then((detail) => live && setFound(detail))
      .catch(() => live && setFound(null));
    return () => {
      live = false;
    };
  }, [folderId, sources, read]);
  return found?.id === folderId ? found : null;
}

/** Where a folder is on disk: its source's directory, then each folder down from it. */
export function diskPath(root: string, path: readonly Crumb[]) {
  return [root.replace(/[\\/]+$/, ""), ...path.slice(1).map((crumb) => crumb.title)].join("\\");
}

/** Closes the band and forgets what was read, for tests. */
export function resetFolderDetail() {
  open = false;
  version = 0;
  changed();
}

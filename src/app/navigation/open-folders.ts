import { useSyncExternalStore } from "react";

// Which folders' rows are open in navigation. Kept here rather than in the tree, so a folder
// that moves can take you with it, opened down to. DECISIONS.md "Navigation".
let open: ReadonlySet<number> = new Set();
const listeners = new Set<() => void>();

export function getOpenFolders() {
  return open;
}

export function useOpenFolders() {
  return useSyncExternalStore(subscribe, getOpenFolders);
}

export function setOpenFolders(next: ReadonlySet<number>) {
  open = next;
  for (const listener of listeners) listener();
}

/** Opens each of these folders, leaving every other as it was. */
export function openFolders(ids: readonly number[]) {
  if (ids.every((id) => open.has(id))) return;
  setOpenFolders(new Set([...open, ...ids]));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

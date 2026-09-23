import { useSyncExternalStore } from "react";

import { setItemFavorite } from "../ipc/commands";

// What was just set wins over what was last read, so the pane's bar and every menu show a change at
// once rather than at the next read of the index.
const chosen = new Map<number, boolean>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

export function isFavourite(itemId: number, read: boolean) {
  return chosen.get(itemId) ?? read;
}

/** Whether an item is a favourite, from what was last read unless it has been set since. */
export function useFavourite(itemId: number, read: boolean) {
  useSyncExternalStore(subscribe, () => version);
  return isFavourite(itemId, read);
}

export function setFavourite(itemId: number, favourite: boolean) {
  chosen.set(itemId, favourite);
  changed();
  void setItemFavorite([itemId], favourite).catch(() => {
    chosen.set(itemId, !favourite);
    changed();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

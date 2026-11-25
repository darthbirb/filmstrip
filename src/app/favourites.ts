import { useSyncExternalStore } from "react";

import { setItemFavorite } from "../ipc/commands";
import { sayFailed } from "./failure";
import { favouriteFailed } from "./undo/lines";

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

/** Whether every one of these is a favourite, each read as `useFavourite` reads it. */
export function useEveryFavourite(items: readonly { id: number; favorite: boolean }[]) {
  useSyncExternalStore(subscribe, () => version);
  return items.length > 0 && items.every((item) => isFavourite(item.id, item.favorite));
}

export function setFavourite(item: { id: number; diskName: string }, favourite: boolean) {
  setFavourites([item.id], favourite, item.diskName);
}

/**
 * Every one of them made a favourite, or none; a mixed set is never half-toggled. One that fails
 * goes back as it was, and the foot says so.
 */
export function setFavourites(itemIds: readonly number[], favourite: boolean, one?: string) {
  const before = itemIds.map((id) => chosen.get(id));
  for (const id of itemIds) chosen.set(id, favourite);
  changed();
  void setItemFavorite([...itemIds], favourite).catch((error: unknown) => {
    itemIds.forEach((id, at) => {
      const was = before[at];
      if (was === undefined) chosen.delete(id);
      else chosen.set(id, was);
    });
    changed();
    sayFailed(favouriteFailed(one ?? itemIds.length, !favourite), error);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

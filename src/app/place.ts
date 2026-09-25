import { useSyncExternalStore } from "react";

/** A folder on the way down from a source's own folder, which is always first. */
export type Crumb = { id: number; title: string };

/** Where the user is. Navigation and the breadcrumb both read and set it. */
export type Place =
  | { kind: "folder"; sourceId: number; path: Crumb[] }
  | { kind: "sorting" }
  | { kind: "trash" };

let current: Place | null = null;
const listeners = new Set<() => void>();

export function getPlace() {
  return current;
}

export function setPlace(next: Place | null) {
  current = next;
  for (const listener of listeners) listener();
}

export function usePlace() {
  return useSyncExternalStore(subscribe, getPlace);
}

/** Calls back after every change of place, the same place set again included. */
export function whenPlaceChanges(listener: () => void) {
  return subscribe(listener);
}

/** The folder being shown, when the place is a folder. */
export function placeFolder(place: Place | null) {
  return place?.kind === "folder" ? place.path.at(-1) : undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

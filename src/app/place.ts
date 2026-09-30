import { useSyncExternalStore } from "react";

/** A folder on the way down from a source's own folder, which is always first. */
export type Crumb = { id: number; title: string };

/** Where the user is. Navigation and the breadcrumb both read and set it. */
export type Place =
  | { kind: "folder"; sourceId: number; path: Crumb[] }
  | { kind: "sorting" }
  | { kind: "trash" }
  /** A query's results, and the place the search began from, which back returns to. */
  | { kind: "search"; query: string; back: Place | null };

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

/** One string per place, the same for the same place however it was reached. */
export function placeKey(place: Place | null) {
  if (place?.kind === "folder") return `folder ${place.path.at(-1)?.id}`;
  if (place?.kind === "search") return `search ${place.query}`;
  return place?.kind ?? "";
}

/** Where a search from here returns to: a search's own way back, so back never leads to results. */
export function backFrom(place: Place | null): Place | null {
  return place?.kind === "search" ? place.back : place;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

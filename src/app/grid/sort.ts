import type { Sort } from "../../ipc/bindings/Sort";
import type { SortKey } from "../../ipc/bindings/SortKey";
import { FIRST_SORT } from "../../ipc/sort";
import type { Place } from "../place";
import {
  getPreferences,
  type Preferences,
  type SortPlace,
  updatePreferences,
  usePreferences,
} from "../preferences";

/** The kind of place whose order a place keeps; the Trash and nowhere keep none. */
export function sortPlace(place: Place | null): SortPlace | undefined {
  return place?.kind === "folder" || place?.kind === "sorting" || place?.kind === "search"
    ? place.kind
    : undefined;
}

/** The order a place is shown in: the one last chosen in its kind, or the first. */
export function sortOf(place: Place | null, preferences: Preferences = getPreferences()): Sort {
  const kind = sortPlace(place);
  return (kind && preferences.sort?.[kind]) || FIRST_SORT;
}

export function useSort(place: Place | null) {
  return sortOf(place, usePreferences());
}

function setSort(kind: SortPlace, change: Partial<Sort>) {
  const sorts = getPreferences().sort ?? {};
  const now = sorts[kind] ?? FIRST_SORT;
  updatePreferences({ sort: { ...sorts, [kind]: { ...now, ...change } } });
}

/** A key picked starts in its first direction; a random order keeps the seed it last drew. */
export function chooseKey(kind: SortPlace, key: SortKey) {
  setSort(kind, { key, dir: "desc" });
}

export function reverse(kind: SortPlace) {
  const now = getPreferences().sort?.[kind] ?? FIRST_SORT;
  if (now.key !== "random") setSort(kind, { dir: now.dir === "desc" ? "asc" : "desc" });
}

/** A new random order, the one thing that draws one. */
export function shuffle(kind: SortPlace) {
  const now = getPreferences().sort?.[kind] ?? FIRST_SORT;
  let seed = now.seed;
  while (seed === now.seed) seed = Math.floor(Math.random() * 2 ** 32);
  setSort(kind, { key: "random", seed });
}

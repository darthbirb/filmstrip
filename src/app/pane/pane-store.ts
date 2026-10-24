import { useSyncExternalStore } from "react";

import type { Place } from "../place";

// The item the pane shows, and the place it was chosen in, which the filmstrip runs through.
// Clicking a picture replaces both. DECISIONS.md "The pane".
// `set` is every file shown, the first one first, and `places` where each was carried from.
type Shown = {
  itemId: number;
  from: Place | null;
  set: readonly number[];
  places: ReadonlyMap<number, Place | null>;
};

let shown: Shown | null = null;
const listeners = new Set<() => void>();
const requests = new Set<() => void>();
const NOTHING: readonly number[] = [];

function changed() {
  for (const listener of listeners) listener();
}

function alone(itemId: number, from: Place | null): Shown {
  return { itemId, from, set: [itemId], places: new Map([[itemId, from]]) };
}

export function showInPane(itemId: number | null, from: Place | null = null) {
  shown = itemId === null ? null : alone(itemId, from);
  changed();
  if (itemId !== null) for (const request of requests) request();
}

/** The place the item was chosen in, moved or renamed: nothing new is put in the pane. */
export function movePaneOrigin(from: Place) {
  if (!shown) return;
  shown = { ...shown, from, places: new Map([...shown.places, [shown.itemId, from]]) };
  changed();
}

/** Calls back each time something is put in the pane, the same item again included. */
export function whenShownInPane(listener: () => void) {
  requests.add(listener);
  return () => {
    requests.delete(listener);
  };
}

export function getPaneItem() {
  return shown?.itemId ?? null;
}

export function getPaneOrigin() {
  return shown?.from ?? null;
}

/** Every file the pane shows, in the order they came; one, or none. */
export function getPaneSet() {
  return shown?.set ?? NOTHING;
}

/**
 * Whether these files going takes the pane on to the next file in its place: when they hold the
 * file it shows alone, or every file of its set. Otherwise those of a set leave it as they go.
 */
export function paneMovesOn(going: readonly number[]) {
  if (!shown) return false;
  return shown.set.every((id) => going.includes(id));
}

/** Where a file in the pane was carried from, which it takes with it when it is shown alone. */
export function paneFileOrigin(itemId: number) {
  return shown?.places.get(itemId) ?? shown?.from ?? null;
}

export function usePaneItem() {
  return useSyncExternalStore(subscribe, getPaneItem);
}

export function usePaneOrigin() {
  return useSyncExternalStore(subscribe, getPaneOrigin);
}

export function usePaneSet() {
  return useSyncExternalStore(subscribe, getPaneSet);
}

/** What a drop of these files on the pane would do. DECISIONS.md "Several files in the pane". */
export type PaneDrop =
  /** Nothing new to add, or no room for it: the pane does not take the drop. */
  | { kind: "refuse"; why: string }
  /** These join what it shows, or take its place when it shows nothing; `of` were carried new. */
  | { kind: "add"; adds: number[]; of: number; replaces: boolean };

/** The most files the pane shows at once. DESIGN.md "Layout". */
export function paneSetLimit() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--pane-set");
  return Number.parseInt(value, 10) || 1;
}

export function paneDrop(carried: readonly number[], limit = paneSetLimit()): PaneDrop {
  const replaces = shown === null;
  const held = new Set(shown?.set ?? []);
  const fresh = [...new Set(carried)].filter((id) => !held.has(id));
  if (fresh.length === 0) return { kind: "refuse", why: "Already in the pane" };
  const room = limit - held.size;
  if (room <= 0) return { kind: "refuse", why: `The pane shows ${limit} at most` };
  return { kind: "add", adds: fresh.slice(0, room), of: fresh.length, replaces };
}

/** Puts files in the pane after what it shows, or in its place over an empty pane. */
export function addToPane(ids: readonly number[], from: Place | null) {
  const [first] = ids;
  if (first === undefined) return;
  const was = shown;
  const base = was ?? alone(first, from);
  const held = new Set(base.set);
  const adds = [...new Set(ids)].filter((id) => !held.has(id));
  const places = new Map(base.places);
  for (const id of adds) places.set(id, from);
  shown = { ...base, set: [...base.set, ...adds], places };
  changed();
  if (was === null) for (const request of requests) request();
}

/**
 * Takes files out of what the pane shows, doing nothing to them. The next file becomes the first
 * when the first goes. The set is never emptied this way: with none left it shows the first alone.
 */
export function leavePane(ids: readonly number[]) {
  if (!shown || shown.set.length < 2) return;
  const going = new Set(ids);
  const set = shown.set.filter((id) => !going.has(id));
  if (set.length === shown.set.length) return;
  const [first = shown.itemId] = set;
  const places = new Map([...shown.places].filter(([id]) => set.includes(id)));
  const from = places.get(first) ?? shown.from;
  shown = set.length === 0 ? alone(first, from) : { itemId: first, from, set, places };
  changed();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

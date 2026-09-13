import { useSyncExternalStore } from "react";

import type { Place } from "../place";

// The item the pane shows, and the place it was chosen in, which the filmstrip runs through.
// Clicking a picture replaces both. DECISIONS.md "The pane".
let shown: { itemId: number; from: Place | null } | null = null;
const listeners = new Set<() => void>();

export function showInPane(itemId: number | null, from: Place | null = null) {
  shown = itemId === null ? null : { itemId, from };
  for (const listener of listeners) listener();
}

export function getPaneItem() {
  return shown?.itemId ?? null;
}

export function getPaneOrigin() {
  return shown?.from ?? null;
}

export function usePaneItem() {
  return useSyncExternalStore(subscribe, getPaneItem);
}

export function usePaneOrigin() {
  return useSyncExternalStore(subscribe, getPaneOrigin);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

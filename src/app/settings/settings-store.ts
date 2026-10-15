import { useSyncExternalStore } from "react";

/** Where Settings opens: a section, and a source whose row is already asking to be removed. */
export type SettingsRequest = { section?: string; asking?: number };

// Null is closed. Held outside the tree, so a menu anywhere can open Settings on a place in it.
let request: SettingsRequest | null = null;
const listeners = new Set<() => void>();

export function openSettings(next: SettingsRequest = {}) {
  request = next;
  for (const listener of listeners) listener();
}

// Set while a restore runs: Escape and the close wait for it. Artboards › Backing up the index.
let held = false;

export function holdSettings(on: boolean) {
  held = on;
}

export function settingsHeld() {
  return held;
}

export function closeSettings() {
  if (request === null || held) return;
  request = null;
  for (const listener of listeners) listener();
}

export function getSettingsRequest() {
  return request;
}

export function useSettingsRequest() {
  return useSyncExternalStore(subscribe, () => request);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

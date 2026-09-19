import { useSyncExternalStore } from "react";

import type { Refusal } from "../../ipc/bindings/Refusal";

/** A folder the app would not take, and the source that stands in the way. */
export type Refused = { why: Refusal; clash: string | null; path: string };

// There is only ever one: a folder refused while the last is still showing takes its
// place, because two bands are two folders. DECISIONS.md "Places, not queries".
let refused: Refused | null = null;
const listeners = new Set<() => void>();

export function getRefused() {
  return refused;
}

export function setRefused(next: Refused | null) {
  refused = next;
  for (const listener of listeners) listener();
}

export function useRefused() {
  return useSyncExternalStore(subscribe, getRefused);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

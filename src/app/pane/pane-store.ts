import { useSyncExternalStore } from "react";

// The item the pane shows. Clicking a picture replaces it. PRODUCT.md "The three panels".
let shown: number | null = null;
const listeners = new Set<() => void>();

export function showInPane(itemId: number | null) {
  shown = itemId;
  for (const listener of listeners) listener();
}

export function getPaneItem() {
  return shown;
}

export function usePaneItem() {
  return useSyncExternalStore(subscribe, getPaneItem);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

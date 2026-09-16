import { useEffect, useSyncExternalStore } from "react";

// Full screen is a state of the pane, not a place you navigate to: leaving puts the pane back in
// whatever state it was in, docked or folded. DECISIONS.md "The pane".
let full = false;
const listeners = new Set<() => void>();

export function getFullScreen() {
  return full;
}

export function setFullScreen(next: boolean) {
  if (full === next) return;
  full = next;
  for (const listener of listeners) listener();
}

export function useFullScreen() {
  return useSyncExternalStore(subscribe, getFullScreen);
}

/** Escape leaves, wherever the focus is: in full screen there is nothing else for it to close. */
export function useEscapeLeavesFullScreen() {
  const shown = useFullScreen();
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

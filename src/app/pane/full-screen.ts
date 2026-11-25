import { useEffect, useSyncExternalStore } from "react";

import { autoPopoverOpen } from "../../ui/Menu";
import { getPaneItem, getPaneSet } from "./pane-store";
import { focusPicture, forgetPictureFocus } from "./picture-focus";

// Full screen is a state of the pane, not a place you navigate to: leaving puts the pane back in
// whatever state it was in, docked or folded. DECISIONS.md "The pane".
let full = false;
const listeners = new Set<() => void>();

export function getFullScreen() {
  return full;
}

/** Entering puts the focus on the picture, whichever way it was entered, so the arrows step at once. */
export function setFullScreen(next: boolean) {
  if (full === next) return;
  full = next;
  const shown = getPaneItem();
  if (!full) forgetPictureFocus();
  else if (shown !== null && getPaneSet().length === 1) focusPicture(shown);
  for (const listener of listeners) listener();
}

export function useFullScreen() {
  return useSyncExternalStore(subscribe, getFullScreen);
}

/**
 * Escape leaves, wherever the focus is, unless an open menu or list keeps the press. It claims the
 * press, so a later listener does not act on it too.
 */
export function useEscapeLeavesFullScreen() {
  const shown = useFullScreen();
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || autoPopoverOpen()) return;
      event.preventDefault();
      setFullScreen(false);
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

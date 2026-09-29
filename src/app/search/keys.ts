import { useEffect } from "react";

import { dragging } from "../grid/drag";
import { getSelection } from "../grid/selection";
import { getFullScreen } from "../pane/full-screen";
import { getPlace } from "../place";
import { goBack } from "./search";

/**
 * Escape leaves a search's results for where it began, once nothing else is open to close first:
 * a menu, a field, full screen, a checked set. Artboards › A search is a place.
 */
export function useSearchKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=menu], [popover]")) {
        return;
      }
      if (document.querySelector("dialog[open]") || getPlace()?.kind !== "search") return;
      if (getFullScreen() || dragging() || getSelection().ids.length > 0) return;
      event.preventDefault();
      goBack();
    };
    // Before full screen's own Escape, so the press that leaves it is not also the one that goes back.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

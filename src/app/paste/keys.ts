import { useEffect } from "react";

import { setNews } from "../navigation/foot-slot";
import { getIndex } from "../navigation/index-store";
import { getPlace } from "../place";
import { inField } from "../undo/undo";
import { counted, readClipboard } from "./clipboard";
import { openPick, pasteInto, sayNoFiles, sortingPlaces } from "./copy";

/**
 * Ctrl+V pastes into the place the grid shows, wherever the focus is but a field, which keeps its
 * own paste; with Settings open it does nothing, as Ctrl+Z does. Artboards › Bringing files in.
 */
export function usePasteKey() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() !== "v" || event.defaultPrevented) return;
      if (inField(event.target) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      void pasteHere();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** A paste into wherever the grid stands, or the band's reason it cannot go there. */
export async function pasteHere() {
  const place = getPlace();
  if (place?.kind === "search") {
    setNews({
      kind: "keyRefused",
      line: "Paste into a folder.",
      detail: "A search holds no files of its own.",
    });
    return;
  }
  if (place?.kind === "trash") {
    setNews({ kind: "keyRefused", line: "Only Delete sends to the Trash." });
    return;
  }
  if (place?.kind === "folder") {
    const folder = place.path.at(-1);
    if (folder) await pasteInto(folder);
    return;
  }
  if (place?.kind !== "sorting") return;
  const places = sortingPlaces(getIndex().sources ?? []);
  const [one] = places;
  if (!one) return;
  if (places.length === 1) {
    await pasteInto(one);
    return;
  }
  // The Box has more than one source, so it asks which against its row, as its menu's Paste does.
  const held = await readClipboard();
  if (!held) {
    sayNoFiles();
    return;
  }
  // Folded, the rail's glyph stands for the row.
  const row =
    document.querySelector<HTMLElement>('[data-row="sorting"]') ??
    document.querySelector<HTMLElement>('button[aria-label^="Sorting Box"]');
  openPick({
    heading: `Paste ${counted(held, true)} Into`,
    anchor: row ? { element: row } : { x: 0, y: 0 },
    places,
    onPick: (to) => void pasteInto(to),
  });
}

import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { whenLibraryChanges } from "../library";
import { type Place, placeKey } from "../place";
import { placeItems } from "./place-items";

/**
 * The items the grid shows for a place, fetched again whenever the library changes. The Trash's
 * are `Trashed` rows, newest first, and a search's are `Hit` rows.
 */
export function useGridItems(place: Place | null) {
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const key = placeKey(place);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the place, whatever object carries it.
  useEffect(() => {
    setItems(null);
    if (!place) return;
    let live = true;
    const load = () => {
      placeItems(place).then(
        (rows) => {
          if (live) setItems(rows);
        },
        () => {
          if (live) setItems([]);
        },
      );
    };
    load();
    const unlisten = listen("job-progress", load).catch(() => undefined);
    const stop = whenLibraryChanges(load);
    return () => {
      live = false;
      stop();
      void unlisten.then((stop) => stop?.());
    };
  }, [key]);

  return items;
}

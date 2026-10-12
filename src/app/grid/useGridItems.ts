import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { whenLibraryChanges } from "../library";
import { type Place, placeKey } from "../place";
import { placeItems } from "./place-items";
import { useSort } from "./sort";

/**
 * The items the grid shows for a place, in the order chosen for it, fetched again whenever the
 * library or the order changes. The Trash's are `Trashed` rows, newest first, and a search's are
 * `Hit` rows.
 */
export function useGridItems(place: Place | null) {
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const key = placeKey(place);
  const sort = useSort(place);
  const order = `${sort.key} ${sort.dir} ${sort.seed}`;
  const shown = useRef(key);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the place, whatever object carries it, and the order is the sort.
  useEffect(() => {
    // Reordering keeps the tiles until the new order arrives; only a new place stands them in.
    if (shown.current !== key) setItems(null);
    shown.current = key;
    if (!place) {
      setItems(null);
      return;
    }
    let live = true;
    const load = () => {
      placeItems(place, sort).then(
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
  }, [key, order]);

  return items;
}

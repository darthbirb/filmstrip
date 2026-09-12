import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { folderItems, sortingItems } from "../../ipc/commands";
import { type Place, placeFolder } from "../place";

/** The items the grid shows for a place, fetched again whenever background work moves on. */
export function useGridItems(place: Place | null) {
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const kind = place?.kind;
  const folderId = placeFolder(place)?.id;

  useEffect(() => {
    setItems(null);
    if (!kind) return;
    let live = true;
    const load = () => {
      const request =
        kind === "sorting"
          ? sortingItems()
          : folderId !== undefined
            ? folderItems(folderId)
            : Promise.resolve([]);
      request.then(
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
    return () => {
      live = false;
      void unlisten.then((stop) => stop?.());
    };
  }, [kind, folderId]);

  return items;
}

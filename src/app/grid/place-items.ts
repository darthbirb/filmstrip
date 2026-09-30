import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { folderItems, sortingItems, trashListing } from "../../ipc/commands";
import type { Place } from "../place";
import { runSearch } from "../search/results";

/** A file in the Trash, wherever it is listed: the Trash's own rows, or a search's that asked. */
export function inTrash(row: ItemRow) {
  return (row as { trashedAt?: number | null }).trashedAt != null;
}

/**
 * A place's files in the order the grid shows them: the Trash's newest first, a search's as it
 * found them. The grid, the pane's filmstrip and the pane moving on all read this one list.
 */
export function placeItems(place: Place | null): Promise<ItemRow[]> {
  switch (place?.kind) {
    case "sorting":
      return sortingItems();
    case "trash":
      return trashListing();
    case "search":
      return runSearch(place.query);
    case "folder": {
      const folder = place.path.at(-1);
      return folder ? folderItems(folder.id) : Promise.resolve([]);
    }
    default:
      return Promise.resolve([]);
  }
}

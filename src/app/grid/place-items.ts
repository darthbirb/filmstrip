import type { ItemRow } from "../../ipc/bindings/ItemRow";
import type { Sort } from "../../ipc/bindings/Sort";
import { folderItems, sortingItems, trashListing } from "../../ipc/commands";
import type { Place } from "../place";
import { runSearch } from "../search/results";
import { sortOf } from "./sort";

/** A file in the Trash, wherever it is listed: the Trash's own rows, or a search's that asked. */
export function inTrash(row: { id: number; trashedAt?: number | null }) {
  return row.trashedAt != null;
}

/**
 * A place's files in the order the grid shows them: the Trash's newest first, every other place's
 * in the order chosen for its kind. The grid, the pane's filmstrip and the pane moving on all read
 * this one list.
 */
export function placeItems(place: Place | null, sort: Sort = sortOf(place)): Promise<ItemRow[]> {
  switch (place?.kind) {
    case "sorting":
      return sortingItems(sort);
    case "trash":
      return trashListing();
    case "search":
      return runSearch(place.query, sort);
    case "folder": {
      const folder = place.path.at(-1);
      return folder ? folderItems(folder.id, sort) : Promise.resolve([]);
    }
    default:
      return Promise.resolve([]);
  }
}

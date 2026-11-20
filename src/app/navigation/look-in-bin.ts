import { lookInBin } from "../../ipc/commands";
import { libraryChanged } from "../library";
import { getPlace, whenPlaceChanges } from "../place";

/**
 * Settles the Trash with the Recycle Bin each time the Trash opens: what was emptied from the bin
 * outside the app leaves it, and what was put back from Explorer is restored. Artboards › The
 * Trash in the Recycle Bin.
 */
export function watchTrashOpening() {
  let inTrash = getPlace()?.kind === "trash";
  return whenPlaceChanges(() => {
    const now = getPlace()?.kind === "trash";
    if (now && !inTrash) void settleTrash();
    inTrash = now;
  });
}

/** Looks in the bin, and has the library look again when that changed anything. */
export async function settleTrash() {
  const looked = await lookInBin().catch(() => null);
  if (looked && looked.retired + looked.restored > 0) await libraryChanged();
}

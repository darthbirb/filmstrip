import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { folderItems, sortingItems, trashItems, trashListing } from "../../ipc/commands";
import { libraryChanged } from "../library";
import type { Place } from "../place";
import { deletedBannerLine } from "../undo/lines";
import { showReport } from "../undo/report-store";
import { afterAct } from "../undo/undo";
import { getPaneItem, getPaneOrigin, showInPane } from "./pane-store";

/**
 * Sends files to the trash and says what happened: the line at the foot for what went, the banner
 * over the grid for what did not. When the pane was showing one of them, it moves on to the file
 * that takes its tile's place. DECISIONS.md "Undo".
 */
export async function deleteFiles(itemIds: number[]) {
  const shown = getPaneItem();
  const origin = getPaneOrigin();
  // Worked out before the list changes, from the order the grid shows it in.
  const next =
    shown !== null && itemIds.includes(shown) ? await neighbour(origin, shown, itemIds) : shown;
  const done = await trashItems(itemIds).catch(() => null);
  if (!done) return;
  const { batch, report } = done;
  if (batch) afterAct(batch, report.refused.length);
  const whole = report.trashed + report.refused.length;
  const [first] = report.refused;
  showReport(
    first
      ? {
          sentence: deletedBannerLine(report.trashed, whole, whole === 1 ? first.name : undefined),
          rows: report.refused,
          retry: () => void deleteFiles(report.refused.map((one) => one.id)),
        }
      : null,
  );
  const stayed = report.refused.some((one) => one.id === shown);
  if (shown !== null && !stayed && next !== shown) showInPane(next, origin);
  await libraryChanged();
}

/** The file after this one in its place, or the one before when it was the last, or none. */
export async function neighbour(place: Place | null, id: number, going: number[]) {
  let rows: ItemRow[] = [];
  if (place?.kind === "sorting") rows = await sortingItems().catch(() => []);
  if (place?.kind === "trash") rows = await trashListing().catch(() => []);
  const folder = place?.kind === "folder" ? place.path.at(-1) : undefined;
  if (folder) rows = await folderItems(folder.id).catch(() => []);
  const left = rows.filter((row) => row.id === id || !going.includes(row.id));
  const here = left.findIndex((row) => row.id === id);
  if (here < 0) return null;
  return left[here + 1]?.id ?? left[here - 1]?.id ?? null;
}

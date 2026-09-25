import type { FolderEntry } from "../../ipc/bindings/FolderEntry";
import type { Reason } from "../../ipc/bindings/Reason";
import { restoreItems } from "../../ipc/commands";
import { libraryChanged } from "../library";
import { restoredBannerLine } from "../undo/lines";
import { showReport } from "../undo/report-store";
import { afterAct } from "../undo/undo";
import { neighbour } from "./delete";
import { getPaneItem, getPaneOrigin, showInPane } from "./pane-store";

/**
 * Takes files out of the Trash, to where each came from or to a folder picked, and says what
 * happened: the line at the foot for what came back, the banner over the grid for what did not.
 * The pane moves on from a file that left the place it was shown in. DECISIONS.md "Undo".
 */
export async function restoreFiles(itemIds: number[], to: FolderEntry | null = null) {
  const shown = getPaneItem();
  const origin = getPaneOrigin();
  const next = shown !== null && itemIds.includes(shown) ? await neighbour(origin, itemIds) : shown;
  const done = await restoreItems(itemIds, to?.id ?? null).catch(() => null);
  if (!done) return;
  const { batch, report } = done;
  if (batch) afterAct(batch, report.refused.length);
  const whole = report.restored + report.refused.length;
  const [first] = report.refused;
  if (first) {
    // Where they were going: the folder picked, where the ones that came back went, or where
    // the one that stayed could not go.
    const went = batch?.act.kind === "restore" ? batch.act.to : null;
    const where = to?.title ?? went ?? placeOf(first.reason);
    const one = whole === 1 ? first.name : undefined;
    showReport({
      sentence: restoredBannerLine(report.restored, whole, where, to === null, one),
      rows: report.refused,
      inTrash: "restoreTo",
      retry: () =>
        void restoreFiles(
          report.refused.map((row) => row.id),
          to,
        ),
    });
  } else {
    showReport(null);
  }
  const stayed = report.refused.some((row) => row.id === shown);
  if (shown !== null && origin?.kind === "trash" && !stayed && next !== shown) {
    showInPane(next, origin);
  }
  await libraryChanged();
}

function placeOf(reason: Reason) {
  if (reason.kind === "folderGone") return reason.name;
  if (reason.kind === "nameTaken") return reason.place;
  return null;
}

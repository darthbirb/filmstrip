import { binlessItems, deleteForGood, trashItems } from "../../ipc/commands";
import { sayFailed } from "../failure";
import { libraryChanged } from "../library";
import { setNews } from "../navigation/foot-slot";
import {
  binRefusedDetail,
  binRefusedLine,
  deletedBannerLine,
  deletedFailed,
  forGoodKeptLine,
  forGoodLine,
} from "../undo/lines";
import { showReport } from "../undo/report-store";
import { afterAct } from "../undo/undo";
import { moveOn, moveOnFrom } from "./move-on";
import { askNoBin } from "./no-bin";

/**
 * Deletes files: those on a drive with no Recycle Bin are asked about, once for them all, and the
 * rest go to the Recycle Bin at once. DECISIONS.md "A drive with no Recycle Bin".
 */
export async function deleteFiles(itemIds: number[]) {
  const back = document.activeElement;
  const drives = await binlessItems(itemIds).catch((error: unknown) => {
    sayFailed(deletedFailed(itemIds.length), error);
    return null;
  });
  if (!drives) return;
  const asked = new Set(drives.flatMap((drive) => drive.files.map((file) => file.id)));
  const rest = itemIds.filter((id) => !asked.has(id));
  const went = rest.length > 0 ? await sendToBin(rest, asked.size) : 0;
  if (asked.size === 0) return;
  askNoBin({
    drives,
    whole: itemIds.length,
    went,
    back: back instanceof HTMLElement ? back : null,
    onDelete: () =>
      void deleteFilesForGood(
        drives.flatMap((drive) => drive.files),
        drives.map((drive) => drive.drive),
      ),
  });
}

/**
 * Sends files to the Recycle Bin and says what happened: the line at the foot for what went and
 * for what the bin alone would not take, the banner over the grid for what else did not go. When
 * the pane was showing one of them, it moves on to the file that takes its tile's place. `asked`
 * counts the files of the same selection waiting on the question. How many went.
 * DECISIONS.md "Undo".
 */
async function sendToBin(itemIds: number[], asked: number) {
  const pane = await moveOnFrom(itemIds);
  const done = await trashItems(itemIds).catch((error: unknown) => {
    sayFailed(deletedFailed(itemIds.length), error);
    return null;
  });
  if (!done) return 0;
  const { batch, report } = done;
  const binOnly =
    report.refused.length > 0 && report.refused.every((one) => one.reason.kind === "binRefused");
  if (binOnly) {
    const line = binRefusedLine(report.refused, report.trashed, asked);
    if (batch) afterAct(batch, 0, line);
    else setNews({ kind: "binRefused", line, detail: binRefusedDetail(report.refused.length) });
  } else if (batch) afterAct(batch, report.refused.length + asked);
  const whole = report.trashed + report.refused.length;
  const [first] = report.refused;
  showReport(
    first && !binOnly
      ? {
          sentence: deletedBannerLine(report.trashed, whole, whole === 1 ? first.name : undefined),
          rows: report.refused,
          retry: () => void deleteFiles(report.refused.map((one) => one.id)),
        }
      : null,
  );
  moveOn(pane, report.refused);
  await libraryChanged();
  return report.trashed;
}

/**
 * Deletes files on drives with no Recycle Bin outright, once asked, and says so at the foot with
 * no Undo; one that would not go stays where it was, and the foot names it.
 */
async function deleteFilesForGood(
  files: readonly { id: number; name: string }[],
  drives: readonly string[],
) {
  const itemIds = files.map((file) => file.id);
  const pane = await moveOnFrom(itemIds);
  const report = await deleteForGood(itemIds).catch((error: unknown) => {
    sayFailed(deletedFailed(itemIds.length), error);
    return null;
  });
  if (!report) return;
  const [first] = report.refused;
  if (first) setNews({ kind: "kept", line: forGoodKeptLine(report.refused, report.deleted) });
  else {
    const one = files.length === 1 ? files[0]?.name : undefined;
    setNews({ kind: "said", line: forGoodLine(report.deleted, drives, one) });
  }
  moveOn(pane, report.refused);
  await libraryChanged();
}

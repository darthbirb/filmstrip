import { useEffect } from "react";

import type { Batch } from "../../ipc/bindings/Batch";
import type { Stayed } from "../../ipc/bindings/Stayed";
import type { UndoReport } from "../../ipc/bindings/UndoReport";
import { canUndo, undoBatch, undoLast } from "../../ipc/commands";
import { libraryChanged } from "../library";
import { getNews, sayOnce, setNews } from "../navigation/foot-slot";
import { actLine, letGo, undoBannerLine, undoneLine } from "./lines";
import { showReport } from "./report-store";

// What follows an act, and the way back from it. DECISIONS.md "Undo".

/** After an act: its line at the foot with Undo, the newest news there. */
export function afterAct(batch: Batch, stayed = 0, line = actLine(batch, stayed)) {
  setNews({ kind: "done", line, batchId: batch.batchId });
}

/** Takes Undo off the foot's line once its act has left the journal, keeping what it did. */
export async function settleLine() {
  const shown = getNews();
  if (shown?.kind !== "done") return;
  const held = await canUndo(shown.batchId).catch(() => true);
  if (!held && getNews() === shown) setNews({ kind: "said", line: shown.line });
}

let undoing = false;

/**
 * Takes back one batch, or the newest when none is named, and says what came back. What was gone
 * from the Recycle Bin or the index is listed until the banner goes, and only what is still there
 * is tried again.
 */
export async function undo(batchId?: string, earlier: readonly Stayed[] = []) {
  if (undoing) return;
  undoing = true;
  try {
    let report: UndoReport | null;
    try {
      report = batchId ? await undoBatch(batchId) : await undoLast();
    } catch {
      // A batch already taken back has nothing left in it.
      report = null;
    }
    if (!report) {
      sayNothing();
      return;
    }
    await libraryChanged();
    const left = report.stayed.filter((row) => !letGo(row));
    const gone = [...earlier, ...report.stayed.filter(letGo)];
    if (left.length + gone.length === 0) {
      setNews({ kind: "undone", line: undoneLine(report), batchId: report.batch.batchId });
      return;
    }
    // The banner is the answer to an undo that came back in part; the foot says nothing.
    setNews(null);
    const again = report.batch.batchId;
    showReport({
      sentence: undoBannerLine(report),
      rows: [...left, ...gone],
      retry: left.length > 0 ? () => void undo(again, gone) : undefined,
    });
  } finally {
    undoing = false;
  }
}

/** "Nothing to undo." answers a key, not an act, so it goes at the next key or click. */
function sayNothing() {
  sayOnce({ kind: "nothing" });
}

/** Ctrl+Z takes back the newest act, wherever the focus is but in a field or over Settings. */
export function useUndoKey() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() !== "z" || event.defaultPrevented) return;
      // A field keeps its own undo, and Settings sits over the window with the keyboard.
      if (inField(event.target) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Whether a key belongs to a field, which keeps its own undo and paste. */
export function inField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

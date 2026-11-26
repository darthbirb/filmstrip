import { useEffect } from "react";

import type { Batch } from "../../ipc/bindings/Batch";
import type { Stayed } from "../../ipc/bindings/Stayed";
import type { UndoReport } from "../../ipc/bindings/UndoReport";
import {
  actToRedo,
  actToUndo,
  canUndo,
  redoBatch,
  redoLast,
  undoBatch,
  undoLast,
} from "../../ipc/commands";
import { libraryChanged } from "../library";
import { getNews, sayOnce, setNews } from "../navigation/foot-slot";
import {
  actLine,
  letGo,
  redoBannerLine,
  redoFailedLine,
  undoBannerLine,
  undoFailedLine,
  undoneLine,
} from "./lines";
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
let redoing = false;

/**
 * Takes back one batch, or the newest when none is named, and says what came back. What was gone
 * from the Recycle Bin or the index is listed until the banner goes, and only what is still there
 * is tried again.
 */
export async function undo(batchId?: string, earlier: readonly Stayed[] = []) {
  if (undoing || redoing) return;
  undoing = true;
  try {
    let report: UndoReport | null;
    try {
      report = batchId ? await undoBatch(batchId) : await undoLast();
    } catch (error) {
      await failed(batchId, error);
      return;
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

/**
 * An undo that failed names its act and why, and keeps its Undo; one whose act is already taken
 * back had nothing left to undo. What came back before it failed is drawn.
 */
async function failed(batchId: string | undefined, error: unknown) {
  await libraryChanged();
  let batch: Batch | null;
  try {
    batch = await actToUndo(batchId ?? null);
  } catch {
    setNews({ kind: "undoFailed", line: undoFailedLine(null, error), batchId });
    return;
  }
  if (!batch) {
    sayNothing();
    return;
  }
  setNews({ kind: "undoFailed", line: undoFailedLine(batch, error), batchId: batch.batchId });
}

/** "Nothing to undo." answers a key, not an act, so it goes at the next key or click. */
function sayNothing(redo = false) {
  sayOnce({ kind: "nothing", redo });
}

/**
 * Carries out again what an undo took back, the batch named or the last undone, and says so as
 * the act did, with its Undo. What could not go again is in the banner, with Retry.
 */
export async function redo(batchId?: string, earlier: readonly Stayed[] = []) {
  if (redoing || undoing) return;
  redoing = true;
  try {
    let report: UndoReport | null;
    try {
      report = batchId ? await redoBatch(batchId) : await redoLast();
    } catch (error) {
      await redoFailed(batchId, error);
      return;
    }
    if (!report) {
      sayNothing(true);
      return;
    }
    await libraryChanged();
    const left = report.stayed.filter((row) => !letGo(row));
    const gone = [...earlier, ...report.stayed.filter(letGo)];
    if (left.length + gone.length === 0) {
      afterAct(report.batch);
      return;
    }
    setNews(null);
    const again = report.batch.batchId;
    showReport({
      sentence: redoBannerLine(report),
      rows: [...left, ...gone],
      retry: left.length > 0 ? () => void redo(again, gone) : undefined,
    });
  } finally {
    redoing = false;
  }
}

async function redoFailed(batchId: string | undefined, error: unknown) {
  await libraryChanged();
  let batch: Batch | null;
  try {
    batch = await actToRedo(batchId ?? null);
  } catch {
    setNews({ kind: "redoFailed", line: redoFailedLine(null, error), batchId });
    return;
  }
  if (!batch) {
    sayNothing(true);
    return;
  }
  setNews({ kind: "redoFailed", line: redoFailedLine(batch, error), batchId: batch.batchId });
}

/** Which of the two a key is: Ctrl+Z, or Ctrl+Y and Ctrl+Shift+Z. */
export function undoKeyOf(
  event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "key">,
) {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === "y" && !event.shiftKey) return "redo";
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  return null;
}

/**
 * Ctrl+Z takes back the newest act, and Ctrl+Y or Ctrl+Shift+Z carries out again what it took
 * back, wherever the focus is but in a field or over Settings.
 */
export function useUndoKey() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = undoKeyOf(event);
      if (key === null || event.defaultPrevented) return;
      // A field keeps its own undo, and Settings sits over the window with the keyboard.
      if (inField(event.target) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      void (key === "undo" ? undo() : redo());
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

import { useEffect } from "react";

import type { Batch } from "../../ipc/bindings/Batch";
import type { UndoReport } from "../../ipc/bindings/UndoReport";
import { undoBatch, undoLast } from "../../ipc/commands";
import { libraryChanged } from "../library";
import { getNews, setNews } from "../navigation/foot-slot";
import { actLine, undoBannerLine, undoneLine } from "./lines";
import { showReport } from "./report-store";

// What follows an act, and the way back from it. DECISIONS.md "Undo".

/** After an act: its line at the foot with Undo, the newest news there. */
export function afterAct(batch: Batch, stayed = 0, line = actLine(batch, stayed)) {
  setNews({ kind: "done", line, batchId: batch.batchId });
}

let undoing = false;

/** Takes back one batch, or the newest when none is named, and says what came back. */
export async function undo(batchId?: string) {
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
    if (report.stayed.length === 0) {
      setNews({ kind: "undone", line: undoneLine(report) });
      return;
    }
    // The banner is the answer to an undo that came back in part; the foot says nothing.
    setNews(null);
    const again = report.batch.batchId;
    showReport({
      sentence: undoBannerLine(report),
      rows: report.stayed,
      retry: () => void undo(again),
    });
  } finally {
    undoing = false;
  }
}

/** "Nothing to undo." answers a key, not an act, so it goes at the next key or click. */
function sayNothing() {
  setNews({ kind: "nothing" });
  const clear = () => {
    window.removeEventListener("keydown", clear, true);
    window.removeEventListener("pointerdown", clear, true);
    if (getNews()?.kind === "nothing") setNews(null);
  };
  // After this key has finished, so it is not the one that clears it.
  setTimeout(() => {
    window.addEventListener("keydown", clear, true);
    window.addEventListener("pointerdown", clear, true);
  });
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

function inField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

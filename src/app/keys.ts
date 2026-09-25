import { useEffect } from "react";

import { itemDetail } from "../ipc/commands";
import { getChecked } from "./grid/selection";
import { setNews } from "./navigation/foot-slot";
import { getIndex } from "./navigation/index-store";
import { neighbour } from "./pane/delete";
import { moveFiles } from "./pane/move-picker";
import { getPaneItem, getPaneOrigin, showInPane } from "./pane/pane-store";
import { getPlace } from "./place";

// Destination keys: the ten digits, each bound to a folder a press moves files into.
// DECISIONS.md "Destination keys".

/** The keys in the order they sit on the keyboard, 1 to 9 then 0. */
export const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

/** The digit a key is, on the top row or the number pad, whatever the layout types there. */
function digitOf(event: KeyboardEvent) {
  const found = /^(?:Digit|Numpad)(\d)$/.exec(event.code);
  return found?.[1] ?? null;
}

/**
 * A digit moves what is checked, or the pane's file when nothing is, to the folder it is bound
 * to. It does nothing in a field, over a menu or Settings, or in the Trash.
 */
export function useDestinationKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const digit = digitOf(event);
      if (digit === null || event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=menu], [popover]")) {
        return;
      }
      if (document.querySelector("dialog[open]") || getPlace()?.kind === "trash") return;
      event.preventDefault();
      void press(digit);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** A press of one key, answered as Artboards › Destination keys draws each case. */
export async function press(digit: string) {
  const bound = getIndex().keys.find((one) => one.key === digit);
  // A key with no folder means nothing yet, like any key the app does not use.
  if (!bound) return;
  const name = bound.path.at(-1)?.title ?? "";
  if (bound.gone) {
    const parent = bound.path.at(-2)?.title;
    setNews({
      kind: "keyRefused",
      line: `Key ${digit} has no folder.`,
      detail: parent ? `${name} has gone from ${parent}.` : `${name} has gone.`,
    });
    return;
  }
  const { checked, listed } = getChecked();
  const shown = getPaneItem();
  const files =
    checked.length > 0
      ? checked
      : shown === null
        ? []
        : [listed.find((row) => row.id === shown) ?? (await itemDetail(shown).catch(() => null))];
  const going = files.flatMap((file) => (file ? [file] : []));
  if (going.length === 0) return;
  if (going.every((file) => file.folderId === bound.folderId)) {
    setNews({ kind: "keyRefused", line: `Already in ${name}.` });
    return;
  }
  const to = { id: bound.folderId, title: name };
  if (checked.length > 0) {
    await moveFiles(
      going.map((file) => file.id),
      to,
    );
    return;
  }
  if (shown === null) return;
  // The pane's file went, so the pane moves on to the tile that took its place, as after a delete.
  const origin = getPaneOrigin();
  const next = await neighbour(origin, [shown]);
  const report = await moveFiles([shown], to);
  const stayed = report === null || report.refused.some((one) => one.id === shown);
  if (!stayed && leaves(origin, bound.sourceId)) showInPane(next, origin);
}

/** Whether a file moved into this source leaves the place it was shown in. */
function leaves(origin: ReturnType<typeof getPaneOrigin>, sourceId: number) {
  if (origin?.kind !== "sorting") return true;
  const source = getIndex().sources?.find((one) => one.id === sourceId);
  return source?.kind !== "sorting";
}

import { useEffect } from "react";

import { copyItemPaths, itemDetail } from "../ipc/commands";
import { failed, unasked } from "./failure";
import { inTrash } from "./grid/place-items";
import { getChecked } from "./grid/selection";
import { setNews } from "./navigation/foot-slot";
import { getIndex } from "./navigation/index-store";
import { deleteFiles } from "./pane/delete";
import { moveFiles } from "./pane/move-picker";
import { getPaneItem, getPaneSet } from "./pane/pane-store";
import { copyFiles } from "./paste/clipboard";
import { getPlace } from "./place";
import { copiedFailed, pathsFailed } from "./undo/lines";

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
      if (digit === null || !keyIsFree(event)) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (getPlace()?.kind === "trash") return;
      event.preventDefault();
      void press(digit);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Whether a key is the app's: not in a field, a menu, a question or Settings. */
function keyIsFree(event: KeyboardEvent) {
  if (event.defaultPrevented) return false;
  const target = event.target instanceof Element ? event.target : null;
  const own = "input, textarea, select, [contenteditable], [role=menu], [popover], [data-question]";
  return !target?.closest(own) && !document.querySelector("dialog[open]");
}

type FileKey = "delete" | "copy" | "copyPath";

function fileKeyOf(event: KeyboardEvent): FileKey | null {
  if (event.altKey || event.metaKey) return null;
  if (event.key === "Delete" && !event.ctrlKey && !event.shiftKey) return "delete";
  if (event.key.toLowerCase() !== "c" || !event.ctrlKey) return null;
  return event.shiftKey ? "copyPath" : "copy";
}

/**
 * Explorer's keys for files: Delete, Ctrl+C and Ctrl+Shift+C do what the bar's Delete, Copy and
 * Copy Path do, to what is checked, or the pane's file when nothing is.
 */
export function useFileKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = fileKeyOf(event);
      if (key === null || !keyIsFree(event)) return;
      event.preventDefault();
      void actOn(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

async function actOn(key: FileKey) {
  const chosen = await chosenFiles();
  // A trashed file goes only by Restore, as the bar in the Trash has nothing else.
  if (!chosen || chosen.files.length === 0 || chosen.files.every(inTrash)) return;
  const ids = chosen.files.map((file) => file.id);
  if (key === "delete") await deleteFiles(ids);
  else if (key === "copy") await copyFiles(ids).catch(failed(copiedFailed(chosen.files)));
  else await copyItemPaths(ids).catch(failed(pathsFailed(chosen.files)));
}

/** What is checked, else the pane's one file; none when the pane shows several and none is checked. */
async function chosenFiles() {
  const { checked, listed } = getChecked();
  if (checked.length > 0) return { files: checked };
  if (getPaneSet().length > 1) return null;
  const shown = getPaneItem();
  const file =
    shown === null
      ? null
      : (listed.find((row) => row.id === shown) ?? (await itemDetail(shown).catch(unasked)));
  return { files: file ? [file] : [] };
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
  const chosen = await chosenFiles();
  // A pane showing several has no one file for a key to move, as it has no bar.
  if (!chosen) {
    setNews({
      kind: "keyRefused",
      line: `The pane shows ${getPaneSet().length} files.`,
      detail: `Check the ones to move to ${name}.`,
    });
    return;
  }
  const going = chosen.files;
  // A trashed file among a search's results goes only by Restore, as in the Trash.
  if (going.length === 0 || going.every(inTrash)) return;
  if (going.every((file) => file.folderId === bound.folderId)) {
    setNews({ kind: "keyRefused", line: `Already in ${name}.` });
    return;
  }
  const to = { id: bound.folderId, title: name };
  await moveFiles(
    going.map((file) => file.id),
    to,
  );
}

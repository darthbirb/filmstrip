import { useSyncExternalStore } from "react";

import type { Carried } from "../../ipc/bindings/Carried";
import { clipboardFiles, copyItems } from "../../ipc/commands";
import { formatCount } from "../../lib/format";

// What the clipboard holds that Paste would bring in, read whenever it may have changed, since a
// menu opens at once and cannot wait on it. DECISIONS.md "Bringing files in".

let held: Carried | null = null;
const listeners = new Set<() => void>();

export function getClipboard() {
  return held;
}

export function useClipboard() {
  return useSyncExternalStore(subscribe, getClipboard);
}

/** Reads the clipboard again, and says what it holds. */
export async function readClipboard() {
  const next = await clipboardFiles().catch(() => null);
  if (next?.files !== held?.files || next?.folders !== held?.folders) {
    held = next;
    for (const listener of listeners) listener();
  }
  return held;
}

/** The app's own Copy: the files themselves on the clipboard, which Paste then counts. */
export async function copyFiles(itemIds: number[]) {
  await copyItems(itemIds);
  await readClipboard();
}

/** As the window takes the focus back from Explorer, and as a menu is about to open. */
export function watchClipboard() {
  const again = () => void readClipboard();
  const press = (event: PointerEvent) => {
    if (event.button === 2) again();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) again();
  };
  window.addEventListener("focus", again);
  window.addEventListener("pointerdown", press, true);
  window.addEventListener("keydown", key, true);
  again();
  return () => {
    window.removeEventListener("focus", again);
    window.removeEventListener("pointerdown", press, true);
    window.removeEventListener("keydown", key, true);
  };
}

/**
 * What is carried, counted as Explorer counts it: "3 files", "1 folder", or "4 items" for a mix;
 * in Title Case for a menu's row.
 */
export function counted({ files, folders }: Carried, title = false) {
  const [count, word] =
    files > 0 && folders > 0
      ? [files + folders, "item"]
      : folders > 0
        ? [folders, "folder"]
        : [files, "file"];
  const words = count === 1 ? word : `${word}s`;
  return `${formatCount(count)} ${title ? words.charAt(0).toUpperCase() + words.slice(1) : words}`;
}

/** Forgets what was read, for tests. */
export function resetClipboard() {
  held = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

import { useSyncExternalStore } from "react";

import { renameItem } from "../../ipc/commands";
import { sayFailed } from "../failure";
import { libraryChanged } from "../library";
import { updatePreferences } from "../preferences";
import { refusedName } from "../undo/lines";
import { afterAct } from "../undo/undo";

// The file whose Name row is a field for now. Rename, from the ⋯ or a file's menu, opens the
// details and puts the cursor there, where the result will show. DECISIONS.md "The pane".
let renaming: number | null = null;
let opener: HTMLElement | null = null;
let giveBack = false;
const listeners = new Set<() => void>();

export function startRename(itemId: number) {
  const at = document.activeElement;
  opener = at instanceof HTMLElement && at !== document.body ? at : null;
  giveBack = false;
  updatePreferences({ details: true });
  renaming = itemId;
  notify();
}

/** `back` when the field closes with the focus in it, which goes back to what opened it. */
export function stopRename(back = false) {
  renaming = null;
  giveBack = back;
  if (!back) opener = null;
  notify();
}

/**
 * The Name row's button, drawn again as the field closes, gives the focus back to what opened
 * the field, or takes it itself once that has gone; only a focus that fell to the page.
 */
export function answerRename(name: HTMLElement | null) {
  if (!name || !giveBack) return;
  const to = opener?.isConnected ? opener : name;
  giveBack = false;
  opener = null;
  const now = document.activeElement;
  if (now === null || now === document.body) to.focus();
}

export function useRenaming() {
  return useSyncExternalStore(subscribe, () => renaming);
}

/**
 * Renames the file on disk; the refusal's sentence when the name cannot be had, else nothing, and
 * the foot says any other failure.
 */
export async function renameFile(
  item: { id: number; diskName: string },
  name: string,
  back = false,
) {
  try {
    const batch = await renameItem(item.id, name);
    stopRename(back);
    if (batch) {
      afterAct(batch);
      await libraryChanged();
    }
    return null;
  } catch (error) {
    const refused = refusedName(error);
    if (refused) return refused;
    stopRename(back);
    sayFailed(`Could not rename ${item.diskName}.`, error);
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

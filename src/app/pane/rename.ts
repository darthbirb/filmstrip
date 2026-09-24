import { useSyncExternalStore } from "react";

import { renameItem } from "../../ipc/commands";
import { libraryChanged } from "../library";
import { updatePreferences } from "../preferences";
import { refusedName } from "../undo/lines";
import { afterAct } from "../undo/undo";

// The file whose Name row is a field for now. Rename, from the ⋯ or a file's menu, opens the
// details and puts the cursor there, where the result will show. DECISIONS.md "The pane".
let renaming: number | null = null;
const listeners = new Set<() => void>();

export function startRename(itemId: number) {
  updatePreferences({ details: true });
  renaming = itemId;
  notify();
}

export function stopRename() {
  renaming = null;
  notify();
}

export function useRenaming() {
  return useSyncExternalStore(subscribe, () => renaming);
}

/** Renames the file on disk; the refusal's sentence when the name is taken, else nothing. */
export async function renameFile(itemId: number, name: string): Promise<string | null> {
  try {
    const batch = await renameItem(itemId, name);
    stopRename();
    if (batch) {
      afterAct(batch);
      await libraryChanged();
    }
    return null;
  } catch (error) {
    const refused = refusedName(error);
    if (!refused) stopRename();
    return refused;
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

import { listen } from "@tauri-apps/api/event";

import type { Deleted } from "../ipc/bindings/Deleted";
import { unasked } from "./failure";
import { afterFolderDeleted } from "./navigation/delete-folder";
import { afterTrashed } from "./pane/delete";
import { afterEmptied } from "./settings/Trash";

/** How each delete on the queue ended, said by what asked for it. DECISIONS.md "Background work". */
export function afterDeleted(deleted: Deleted) {
  if (deleted.kind === "files") return afterTrashed(deleted);
  if (deleted.kind === "folder") return afterFolderDeleted(deleted);
  return afterEmptied(deleted);
}

/** Hears how each delete on the queue ended. */
export async function watchDeletes() {
  await listen<Deleted>("delete-done", ({ payload }) => void afterDeleted(payload)).catch(unasked);
}

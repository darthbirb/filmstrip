import { listen } from "@tauri-apps/api/event";

import type { Expired } from "../../ipc/bindings/Expired";
import { libraryChanged } from "../library";
import { expiredLine, refusedLine } from "../settings/expiry-words";
import { setNews } from "./foot-slot";

/**
 * What a run of the Trash's limits says at the foot: what went, with no Undo, or, when the
 * Recycle Bin refused more files than at the last run, that they stay. Artboards › The Trash's limits.
 */
export async function afterExpired(expired: Expired) {
  await libraryChanged();
  if (expired.refusedGrew) {
    setNews({
      kind: "expiryRefused",
      ...refusedLine(expired.refused),
      first: expired.firstRefused,
    });
  } else if (expired.byAge + expired.bySize > 0) {
    setNews({ kind: "expired", line: expiredLine(expired) });
  }
}

/** Hears each run of the Trash's limits that has something to say. */
export async function watchExpiry() {
  await listen<Expired>("trash-expired", ({ payload }) => void afterExpired(payload)).catch(
    () => undefined,
  );
}

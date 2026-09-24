import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import type { EffectiveTag } from "../../ipc/bindings/EffectiveTag";
import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { itemDetail, itemPath, itemTags } from "../../ipc/commands";
import { whenLibraryChanges } from "../library";

export type Shown =
  | { status: "empty" }
  | { status: "loading" }
  /** Gone from disk; where it was, while the index still remembers. */
  | { status: "gone"; path: string | null }
  | { status: "ready"; item: ItemDetail; tags: EffectiveTag[] };

/** An item in full with its tags, read again whenever the library changes. */
export function useItemDetail(itemId: number | null) {
  const [shown, setShown] = useState<Shown>({ status: "empty" });

  useEffect(() => {
    if (itemId === null) {
      setShown({ status: "empty" });
      return;
    }
    // The previous item stays up until the next arrives, so a click never flashes an empty pane.
    setShown((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    let live = true;
    const load = () => {
      const gone = () =>
        itemPath(itemId).then(
          (path) => live && setShown({ status: "gone", path }),
          () => live && setShown({ status: "gone", path: null }),
        );
      Promise.all([itemDetail(itemId), itemTags(itemId)]).then(
        ([item, tags]) => {
          if (!live) return;
          if (item) setShown({ status: "ready", item, tags });
          else void gone();
        },
        () => void gone(),
      );
    };
    load();
    const unlisten = listen("job-progress", load).catch(() => undefined);
    const stop = whenLibraryChanges(load);
    return () => {
      live = false;
      stop();
      void unlisten.then((stop) => stop?.());
    };
  }, [itemId]);

  return shown;
}

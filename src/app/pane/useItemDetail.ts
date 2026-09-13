import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import type { EffectiveTag } from "../../ipc/bindings/EffectiveTag";
import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { itemDetail, itemTags } from "../../ipc/commands";

export type Shown =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "gone" }
  | { status: "ready"; item: ItemDetail; tags: EffectiveTag[] };

/** An item in full with its tags, read again whenever background work moves on. */
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
      Promise.all([itemDetail(itemId), itemTags(itemId)]).then(
        ([item, tags]) => {
          if (live) setShown(item ? { status: "ready", item, tags } : { status: "gone" });
        },
        () => {
          if (live) setShown({ status: "gone" });
        },
      );
    };
    load();
    const unlisten = listen("job-progress", load).catch(() => undefined);
    return () => {
      live = false;
      void unlisten.then((stop) => stop?.());
    };
  }, [itemId]);

  return shown;
}

import { listen } from "@tauri-apps/api/event";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { itemDetail } from "../../ipc/commands";
import { whenLibraryChanges } from "../library";
import { leavePane, usePaneItem, usePaneSet } from "./pane-store";
import { type Shown, useItemDetail } from "./useItemDetail";

const PaneDetail = createContext<Shown>({ status: "empty" });
const PaneSetDetail = createContext<readonly ItemDetail[] | null>(null);

/** Reads the pane's item once for both halves of the pane: its header row and its body. */
export function PaneDetailProvider({ children }: { children: ReactNode }) {
  return (
    <PaneDetail value={useItemDetail(usePaneItem())}>
      <PaneSetDetail value={useSetDetail(usePaneSet())}>{children}</PaneSetDetail>
    </PaneDetail>
  );
}

export function usePaneDetail() {
  return useContext(PaneDetail);
}

/** Every file the pane shows in full, once read, while it shows more than one; else none. */
export function usePaneSetDetail() {
  return useContext(PaneSetDetail);
}

/**
 * The set's files, read again whenever the library changes. A file deleted, moved to another
 * folder or gone from the index leaves the set. DECISIONS.md "Several files in the pane".
 */
function useSetDetail(ids: readonly number[]) {
  const [items, setItems] = useState<readonly ItemDetail[] | null>(null);
  const several = ids.length > 1;

  useEffect(() => {
    if (!several) {
      setItems(null);
      return;
    }
    let live = true;
    const seen = new Map<number, ItemDetail>();
    const load = () => {
      void Promise.all(ids.map((id) => itemDetail(id).catch(() => null))).then((found) => {
        if (!live) return;
        const leaving: number[] = [];
        const kept: ItemDetail[] = [];
        ids.forEach((id, at) => {
          const now = found[at];
          const was = seen.get(id);
          const left =
            !now ||
            (was !== undefined &&
              (was.folderId !== now.folderId ||
                (was.trashedAt === null) !== (now.trashedAt === null)));
          if (left) leaving.push(id);
          else if (now) {
            seen.set(id, now);
            kept.push(now);
          }
        });
        setItems(kept);
        if (leaving.length > 0) leavePane(leaving);
      });
    };
    load();
    const unlisten = listen("job-progress", load).catch(() => undefined);
    const stop = whenLibraryChanges(load);
    return () => {
      live = false;
      stop();
      void unlisten.then((stop) => stop?.());
    };
  }, [ids, several]);

  return several ? items : null;
}

import { listen } from "@tauri-apps/api/event";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import type { FolderDetail } from "../../ipc/bindings/FolderDetail";
import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { folderDetail, itemsDetail } from "../../ipc/commands";
import { diskPath, useDetailVersion } from "../grid/folder-detail";
import { whenLibraryChanges } from "../library";
import { useIndex } from "../navigation/index-store";
import { leavePane, type PaneFolder, usePaneFolder, usePaneItem, usePaneSet } from "./pane-store";
import { type Shown, useItemDetail } from "./useItemDetail";

const PaneDetail = createContext<Shown>({ status: "empty" });
const PaneSetDetail = createContext<readonly ItemDetail[] | null>(null);

/** A folder the pane shows, as its band reads it. */
export type FolderShown =
  | { status: "empty" }
  | { status: "loading" }
  /** Gone from the index other than by the app's own act; where it was, once it had been read. */
  | { status: "gone"; path: string | null }
  | { status: "ready"; detail: FolderDetail; source: SourceSummary };

const PaneFolderDetail = createContext<FolderShown>({ status: "empty" });

/** Reads the pane's item once for both halves of the pane: its header row and its body. */
export function PaneDetailProvider({ children }: { children: ReactNode }) {
  return (
    <PaneDetail value={useItemDetail(usePaneItem())}>
      <PaneSetDetail value={useSetDetail(usePaneSet())}>
        <PaneFolderDetail value={useFolderShown(usePaneFolder())}>{children}</PaneFolderDetail>
      </PaneSetDetail>
    </PaneDetail>
  );
}

/** The folder the pane shows in a file's place, once read; empty while it shows none. */
export function usePaneFolderDetail() {
  return useContext(PaneFolderDetail);
}

/**
 * The folder, read again whenever the index, the library or the folder itself changes. It is
 * followed by its id, so a move or a rename inside the app keeps it. Pane › folder.
 */
function useFolderShown(folder: PaneFolder | null): FolderShown {
  const { sources } = useIndex();
  const version = useDetailVersion();
  const [found, setFound] = useState<{ id: number; detail: FolderDetail | null } | null>(null);
  const last = useRef<{ id: number; path: string } | null>(null);
  const folderId = folder?.folderId ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the index and the version are when to read again.
  useEffect(() => {
    if (folderId === null) return;
    let live = true;
    const load = () => {
      folderDetail(folderId).then(
        (detail) => live && setFound({ id: folderId, detail }),
        () => live && setFound({ id: folderId, detail: null }),
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
  }, [folderId, sources, version]);

  if (folderId === null) return { status: "empty" };
  if (found?.id !== folderId) return { status: "loading" };
  const { detail } = found;
  const source = detail && sources?.find((one) => one.id === detail.sourceId);
  if (detail && source) {
    last.current = { id: folderId, path: diskPath(source.root, detail.path) };
    return { status: "ready", detail, source };
  }
  if (detail === null) {
    return { status: "gone", path: last.current?.id === folderId ? last.current.path : null };
  }
  return { status: "loading" };
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
      void itemsDetail(ids)
        .catch(() => ids.map(() => null))
        .then((found) => {
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

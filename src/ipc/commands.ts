import { invoke } from "@tauri-apps/api/core";
import type { AddOutcome } from "./bindings/AddOutcome";
import type { Batch } from "./bindings/Batch";
import type { Contents } from "./bindings/Contents";
import type { EffectiveTag } from "./bindings/EffectiveTag";
import type { Failure } from "./bindings/Failure";
import type { FolderDeleted } from "./bindings/FolderDeleted";
import type { FolderMade } from "./bindings/FolderMade";
import type { FolderNode } from "./bindings/FolderNode";
import type { ItemDetail } from "./bindings/ItemDetail";
import type { ItemRow } from "./bindings/ItemRow";
import type { ItemsMoved } from "./bindings/ItemsMoved";
import type { ItemsTrashed } from "./bindings/ItemsTrashed";
import type { Progress } from "./bindings/Progress";
import type { SourceKind } from "./bindings/SourceKind";
import type { SourceSummary } from "./bindings/SourceSummary";
import type { UndoReport } from "./bindings/UndoReport";

// One wrapper per Rust command, each typed invoke on one line: a Rust test reads this file.
// DEVELOPMENT.md "The command boundary".

/** What a failed command rejects with; `kind` mirrors `AppError::kind` in Rust. */
export type AppError = {
  kind: "io" | "db" | "json" | "invalid" | "media" | "refused";
  message: string;
};

export const listSources = () => invoke<SourceSummary[]>("list_sources");

export const addSource = (root: string, kind: SourceKind, title?: string) =>
  invoke<AddOutcome>("add_source", { root, kind, title });

export const pickFolder = () => invoke<string | null>("pick_folder");

export const renameSource = (id: number, title: string) =>
  invoke<void>("rename_source", { id, title });

export const setSourceKind = (id: number, kind: SourceKind) =>
  invoke<void>("set_source_kind", { id, kind });

export const revealSource = (id: number) => invoke<void>("reveal_source", { id });

export const removeSource = (id: number) => invoke<void>("remove_source", { id });

export const revealFolder = (folderId: number) => invoke<void>("reveal_folder", { folderId });

export const readFolderAgain = (folderId: number) =>
  invoke<void>("read_folder_again", { folderId });

export const createFolder = (parentId: number, title: string) =>
  invoke<FolderMade>("create_folder", { parentId, title });

export const renameFolder = (folderId: number, title: string) =>
  invoke<Batch | null>("rename_folder", { folderId, title });

export const moveFolder = (folderId: number, parentId: number) =>
  invoke<Batch | null>("move_folder", { folderId, parentId });

export const moveItems = (itemIds: number[], folderId: number) =>
  invoke<ItemsMoved>("move_items", { itemIds, folderId });

export const trashItems = (itemIds: number[]) => invoke<ItemsTrashed>("trash_items", { itemIds });

export const folderFileCount = (folderId: number) =>
  invoke<number>("folder_file_count", { folderId });

export const deleteFolder = (folderId: number, contents: Contents | null) =>
  invoke<FolderDeleted>("delete_folder", { folderId, contents });

export const undoLast = () => invoke<UndoReport | null>("undo_last");

export const undoBatch = (batchId: string) => invoke<UndoReport>("undo_batch", { batchId });

export const folderChildren = (folderId: number) =>
  invoke<FolderNode[]>("folder_children", { folderId });

export const folderItems = (folderId: number) => invoke<ItemRow[]>("folder_items", { folderId });

export const itemTags = (itemId: number) => invoke<EffectiveTag[]>("item_tags", { itemId });

export const itemDetail = (itemId: number) => invoke<ItemDetail | null>("item_detail", { itemId });

export const itemPath = (itemId: number) => invoke<string | null>("item_path", { itemId });

export const sortingItems = () => invoke<ItemRow[]>("sorting_items");

export const setItemFavorite = (itemIds: number[], favorite: boolean) =>
  invoke<void>("set_item_favorite", { itemIds, favorite });

export const revealItem = (itemId: number) => invoke<void>("reveal_item", { itemId });

export const openItem = (itemId: number) => invoke<void>("open_item", { itemId });

export const copyItemFile = (itemId: number) => invoke<void>("copy_item_file", { itemId });

export const startIndex = () => invoke<void>("start_index");

export const indexProgress = () => invoke<Progress>("index_progress");

export const indexFailures = () => invoke<Failure[]>("index_failures");

export const retryFailedJobs = () => invoke<number>("retry_failed_jobs");

export const uiPreferences = () => invoke<unknown>("ui_preferences");

export const setUiPreferences = (preferences: unknown) =>
  invoke<void>("set_ui_preferences", { preferences });

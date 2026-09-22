import { invoke } from "@tauri-apps/api/core";
import type { AddOutcome } from "./bindings/AddOutcome";
import type { EffectiveTag } from "./bindings/EffectiveTag";
import type { Failure } from "./bindings/Failure";
import type { FolderNode } from "./bindings/FolderNode";
import type { ItemDetail } from "./bindings/ItemDetail";
import type { ItemRow } from "./bindings/ItemRow";
import type { Progress } from "./bindings/Progress";
import type { SourceKind } from "./bindings/SourceKind";
import type { SourceSummary } from "./bindings/SourceSummary";

// One wrapper per Rust command, each typed invoke on one line: a Rust test reads this file.
// DEVELOPMENT.md "The command boundary".

/** What a failed command rejects with; `kind` mirrors `AppError::kind` in Rust. */
export type AppError = { kind: "io" | "db" | "json" | "invalid" | "media"; message: string };

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

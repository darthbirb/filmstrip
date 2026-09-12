import { invoke } from "@tauri-apps/api/core";

import type { EffectiveTag } from "./bindings/EffectiveTag";
import type { FolderNode } from "./bindings/FolderNode";
import type { ItemRow } from "./bindings/ItemRow";
import type { Source } from "./bindings/Source";
import type { SourceKind } from "./bindings/SourceKind";
import type { SourceSummary } from "./bindings/SourceSummary";
import type { WalkReport } from "./bindings/WalkReport";

// One wrapper per Rust command, each typed invoke on one line: a Rust test reads this file.
// DEVELOPMENT.md "The command boundary".

/** What a failed command rejects with; `kind` mirrors `AppError::kind` in Rust. */
export type AppError = { kind: "io" | "db" | "json" | "invalid"; message: string };

export const listSources = () => invoke<SourceSummary[]>("list_sources");

export const addSource = (root: string, kind: SourceKind, title?: string) =>
  invoke<Source>("add_source", { root, kind, title });

export const removeSource = (id: number) => invoke<void>("remove_source", { id });

export const folderChildren = (folderId: number) =>
  invoke<FolderNode[]>("folder_children", { folderId });

export const folderItems = (folderId: number) => invoke<ItemRow[]>("folder_items", { folderId });

export const itemTags = (itemId: number) => invoke<EffectiveTag[]>("item_tags", { itemId });

export const reconcile = () => invoke<WalkReport>("reconcile");

export const uiPreferences = () => invoke<unknown>("ui_preferences");

export const setUiPreferences = (preferences: unknown) =>
  invoke<void>("set_ui_preferences", { preferences });

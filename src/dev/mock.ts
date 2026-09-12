import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { FolderNode } from "../ipc/bindings/FolderNode";
import type { ItemRow } from "../ipc/bindings/ItemRow";
import type { SourceKind } from "../ipc/bindings/SourceKind";
import type { SourceSummary } from "../ipc/bindings/SourceSummary";
import type { WalkReport } from "../ipc/bindings/WalkReport";
import type { AppError } from "../ipc/commands";

// A small library for the dev server and component tests, typed by the Rust bindings so it
// cannot drift from them. DEVELOPMENT.md "Seeing the app".

let nextItemId = 1;

function source(
  id: number,
  root: string,
  title: string,
  kind: SourceKind,
  itemCount: number,
): SourceSummary {
  const totalBytes = itemCount * 2_400_000;
  return {
    id,
    root,
    title,
    kind,
    addedAt: 0,
    rootFolderId: id,
    reachable: true,
    itemCount,
    totalBytes,
  };
}

function folder(id: number, title: string, childCount: number, itemCount: number): FolderNode {
  return { id, title, childCount, itemCount };
}

function items(folderId: number, names: string[]): ItemRow[] {
  return names.map((diskName) => {
    const id = nextItemId++;
    const ext = diskName.split(".").pop() ?? "";
    const video = ext === "mp4";
    return {
      id,
      uuid: `mock-${id}`,
      folderId,
      diskName,
      ext,
      kind: video ? "video" : "image",
      sizeBytes: 2_400_000,
      mtime: 1_750_000_000,
      width: 4000,
      height: 3000,
      durationMs: video ? 12_000 : null,
      favorite: false,
    };
  });
}

const SOURCES: SourceSummary[] = [
  source(1, "D:\\Pictures", "Pictures", "library", 6),
  source(2, "D:\\Incoming", "Incoming", "sorting", 3),
  { ...source(3, "E:\\Archive", "Archive", "library", 0), reachable: false },
];

const FOLDERS: Record<number, FolderNode[]> = {
  1: [folder(5, "People", 0, 0), folder(4, "Trips", 1, 2)],
  4: [folder(6, "Cairo", 0, 3)],
};

const ITEMS: Record<number, ItemRow[]> = {
  1: items(1, ["cover.jpg"]),
  2: items(2, ["DSC_0001.jpg", "DSC_0002.jpg", "clip.mp4"]),
  4: items(4, ["boarding-pass.png", "hotel.jpg"]),
  6: items(6, ["felucca.mp4", "pyramid.jpg", "sphinx.jpg"]),
};

type Args = Record<string, unknown>;

const COMMANDS: Record<string, (args: Args) => unknown> = {
  list_sources: () => SOURCES,
  add_source: () =>
    Promise.reject<AppError>({ kind: "invalid", message: "Adding a source needs the real app." }),
  remove_source: () => null,
  folder_children: ({ folderId }) => FOLDERS[folderId as number] ?? [],
  folder_items: ({ folderId }) => ITEMS[folderId as number] ?? [],
  item_tags: () => [],
  reconcile: (): WalkReport => ({ unchanged: 15, indexed: 0, itemsRetired: 0, foldersRetired: 0 }),
};

mockWindows("main");
mockIPC((cmd, payload) => {
  if (cmd.startsWith("plugin:")) return undefined;
  const command = COMMANDS[cmd];
  if (!command) throw new Error(`the dev mock does not know the command "${cmd}"`);
  return command((payload ?? {}) as Args);
});

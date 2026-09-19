import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Crumb } from "../ipc/bindings/Crumb";
import type { FolderNode } from "../ipc/bindings/FolderNode";
import type { ItemDetail } from "../ipc/bindings/ItemDetail";
import type { ItemRow } from "../ipc/bindings/ItemRow";
import type { Progress } from "../ipc/bindings/Progress";
import type { SourceKind } from "../ipc/bindings/SourceKind";
import type { SourceSummary } from "../ipc/bindings/SourceSummary";
import type { AppError } from "../ipc/commands";

// A small library for the dev server and component tests, typed by the Rust bindings so it
// cannot drift from them. DEVELOPMENT.md "Seeing the app".

let nextItemId = 1;

/** Landscape, portrait, square and panorama, so layouts and the pane have real shapes to fit. */
const SHAPES = [
  [4000, 3000],
  [3000, 4000],
  [4000, 4000],
  [6000, 2000],
];

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
    const [width, height] = SHAPES[id % SHAPES.length] as [number, number];
    return {
      id,
      uuid: `mock-${id}`,
      folderId,
      diskName,
      ext,
      kind: video ? "video" : "image",
      sizeBytes: 2_400_000,
      mtime: 1_750_000_000,
      width,
      height,
      durationMs: video ? 12_000 : null,
      favorite: false,
      thumb: `thumbs\\mock-${id}.webp`,
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

/** Each folder's parent and title, read off the tree above. */
const PARENTS = new Map(
  Object.entries(FOLDERS).flatMap(([parent, children]) =>
    children.map((child) => [child.id, { parent: Number(parent), title: child.title }] as const),
  ),
);

const everyItem = () => Object.values(ITEMS).flat();

/** An item in full, as `item_detail` answers: PNGs carry no capture date, as screenshots don't. */
function detail(itemId: number): ItemDetail | null {
  const row = everyItem().find((item) => item.id === itemId);
  if (!row) return null;
  const folders: Crumb[] = [];
  let at: number | undefined = row.folderId;
  let home: SourceSummary | undefined;
  while (at !== undefined && !home) {
    const id: number = at;
    home = SOURCES.find((candidate) => candidate.rootFolderId === id);
    const step = PARENTS.get(id);
    folders.unshift({ id, title: home?.title ?? step?.title ?? "" });
    at = step?.parent;
  }
  if (!home) return null;
  const video = row.kind === "video";
  const dated = row.ext !== "png";
  return {
    ...row,
    codec: video ? "h264" : null,
    bitrate: video ? 8_000_000 : null,
    capturedAt: dated ? 1_718_188_401 : null,
    capturedSrc: dated ? (video ? "container" : "exif") : null,
    addedAt: 1_750_000_000,
    sourceId: home.id,
    sourceKind: home.kind,
    folders,
    path: [home.root, ...folders.slice(1).map((crumb) => crumb.title), row.diskName].join("\\"),
  };
}

/** The mock has no files, so every path it hands out is drawn: a wash in the item's own shape. */
function drawn(path: string) {
  const item = everyItem().find((row) => row.thumb === path || path.endsWith(`\\${row.diskName}`));
  const [width, height] = [item?.width ?? 4, item?.height ?? 3];
  const hue = ((item?.id ?? 0) * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 45% 25%)"/></linearGradient><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type Args = Record<string, unknown>;

let storedPreferences: unknown = null;

const COMMANDS: Record<string, (args: Args) => unknown> = {
  ui_preferences: () => storedPreferences,
  set_ui_preferences: ({ preferences }) => {
    storedPreferences = preferences;
    return null;
  },
  list_sources: () => SOURCES,
  add_source: () =>
    Promise.reject<AppError>({ kind: "invalid", message: "Adding a source needs the real app." }),
  // The picker is the system's, so outside Tauri there is nothing to open and nothing chosen.
  pick_folder: () => null,
  rename_source: () => null,
  set_source_kind: () => null,
  reveal_source: () => null,
  remove_source: () => null,
  folder_children: ({ folderId }) => FOLDERS[folderId as number] ?? [],
  folder_items: ({ folderId }) => ITEMS[folderId as number] ?? [],
  item_tags: () => [],
  item_detail: ({ itemId }) => detail(itemId as number),
  sorting_items: () => ITEMS[2] ?? [],
  // The bar acts on the mock library as it would on a real one, so the dev window shows the state.
  set_item_favorite: ({ itemIds, favorite }) => {
    const wanted = new Set(itemIds as number[]);
    for (const item of everyItem()) {
      if (wanted.has(item.id)) item.favorite = favorite as boolean;
    }
    return null;
  },
  reveal_item: () => null,
  open_item: () => null,
  copy_item_file: () => null,
  start_index: () => null,
  index_progress: (): Progress => ({
    phase: "idle",
    pending: 0,
    running: 0,
    failed: 0,
    completed: 0,
  }),
  index_failures: () => [],
  retry_failed_jobs: () => 0,
};

mockWindows("main");
mockIPC((cmd, payload) => {
  if (cmd.startsWith("plugin:")) return undefined;
  const command = COMMANDS[cmd];
  if (!command) throw new Error(`the dev mock does not know the command "${cmd}"`);
  return command((payload ?? {}) as Args);
});
// Tauri's own mock would turn each path into an asset URL that nothing here answers.
(
  window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => string } }
).__TAURI_INTERNALS__.convertFileSrc = drawn;

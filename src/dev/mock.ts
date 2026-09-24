import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Act } from "../ipc/bindings/Act";
import type { Batch } from "../ipc/bindings/Batch";
import type { Crumb } from "../ipc/bindings/Crumb";
import type { FolderEntry } from "../ipc/bindings/FolderEntry";
import type { FolderNode } from "../ipc/bindings/FolderNode";
import type { ItemDetail } from "../ipc/bindings/ItemDetail";
import type { ItemRow } from "../ipc/bindings/ItemRow";
import type { ItemsMoved } from "../ipc/bindings/ItemsMoved";
import type { ItemsTrashed } from "../ipc/bindings/ItemsTrashed";
import type { Progress } from "../ipc/bindings/Progress";
import type { Reason } from "../ipc/bindings/Reason";
import type { SourceKind } from "../ipc/bindings/SourceKind";
import type { SourceSummary } from "../ipc/bindings/SourceSummary";
import type { Stayed } from "../ipc/bindings/Stayed";
import type { UndoReport } from "../ipc/bindings/UndoReport";
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

/** Where the mock keeps what was sent to the trash: a folder no place shows. */
const TRASH = -1;

const everyItem = () =>
  Object.entries(ITEMS).flatMap(([folder, rows]) => (Number(folder) === TRASH ? [] : rows));

/** From the source's own folder down to this one, and the source it is in. */
function crumbs(folderId: number) {
  const folders: Crumb[] = [];
  let at: number | undefined = folderId;
  let home: SourceSummary | undefined;
  while (at !== undefined && !home) {
    const id: number = at;
    home = SOURCES.find((candidate) => candidate.rootFolderId === id);
    const step = PARENTS.get(id);
    folders.unshift({ id, title: home?.title ?? step?.title ?? "" });
    at = step?.parent;
  }
  return { folders, home };
}

/** An item in full, as `item_detail` answers: PNGs carry no capture date, as screenshots don't. */
function detail(itemId: number): ItemDetail | null {
  const row = everyItem().find((item) => item.id === itemId);
  if (!row) return null;
  const { folders, home } = crumbs(row.folderId);
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
  const [full, tall] = [item?.width ?? 4, item?.height ?? 3];
  // A thumbnail is drawn at its real size, 320px on the longest edge, as the app makes them.
  const shrink = item && path === item.thumb ? Math.min(1, 320 / Math.max(full, tall)) : 1;
  const [width, height] = [Math.round(full * shrink), Math.round(tall * shrink)];
  const hue = ((item?.id ?? 0) * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 45% 25%)"/></linearGradient><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// A journal as the Rust one keeps it, small enough to read: each act is a batch of steps, and
// an undo takes the newest batch back.
type Step =
  | { op: "move"; item: ItemRow; from: number }
  | { op: "trash"; item: ItemRow; from: number }
  | { op: "rename"; item: ItemRow; from: string; to: string };
const journal: { batchId: string; steps: Step[] }[] = [];
let nextBatch = 1;

const folderName = (id: number) => crumbs(id).folders.at(-1)?.title ?? "";

/** Puts an item in another folder, keeping every count in the tree true. */
function relocate(item: ItemRow, to: number) {
  const from = item.folderId;
  ITEMS[from] = (ITEMS[from] ?? []).filter((other) => other !== item);
  item.folderId = to;
  ITEMS[to] = [...(ITEMS[to] ?? []), item];
  for (const id of [from, to]) {
    for (const node of Object.values(FOLDERS).flat()) {
      if (node.id === id) node.itemCount = ITEMS[id]?.length ?? 0;
    }
  }
}

function taken(folderId: number, name: string, item: ItemRow) {
  const lower = name.toLowerCase();
  return (ITEMS[folderId] ?? []).some((o) => o !== item && o.diskName.toLowerCase() === lower);
}

function stayedIn(item: ItemRow, reason: Reason): Stayed {
  const path = crumbs(item.folderId).folders.map((crumb) => crumb.title);
  const at = { kind: "folder" as const, folderId: item.folderId, path };
  return { kind: "file", id: item.id, name: item.diskName, at, reason };
}

function describe(batchId: string, steps: Step[]): Batch {
  const [first] = steps;
  const from = new Set(steps.map((step) => ("from" in step ? step.from : 0)));
  const only = from.size === 1 && first?.op !== "rename" ? folderName(first?.from ?? 0) : null;
  const one = steps.length === 1 && first ? first.item.diskName : null;
  const act: Act =
    first?.op === "rename"
      ? { kind: "renameFile", from: first.from, to: first.to }
      : first?.op === "trash"
        ? { kind: "delete", from: only, one }
        : { kind: "move", from: only, to: folderName(first?.item.folderId ?? 0), one };
  return { batchId, act, files: steps.length, folders: 0 };
}

function record(steps: Step[]) {
  if (steps.length === 0) return null;
  const batchId = `mock-batch-${nextBatch++}`;
  journal.push({ batchId, steps });
  return describe(batchId, steps);
}

function takeBack(at: number): UndoReport {
  const [{ batchId, steps }] = journal.splice(at, 1) as [{ batchId: string; steps: Step[] }];
  // Described before anything comes back, as the Rust journal is.
  const batch = describe(batchId, steps);
  for (const step of [...steps].reverse()) {
    if (step.op === "move" || step.op === "trash") relocate(step.item, step.from);
    else step.item.diskName = step.from;
  }
  return { batch, filesBack: steps.length, foldersBack: 0, stayed: [] };
}

type Args = Record<string, unknown>;

let storedPreferences: unknown = null;

const COMMANDS: Record<string, (args: Args) => unknown> = {
  ui_preferences: () => storedPreferences,
  set_ui_preferences: ({ preferences }) => {
    storedPreferences = preferences;
    return null;
  },
  // `?no-sources` empties the library, which is the only way to see the doorways it draws instead.
  list_sources: () => (new URLSearchParams(location.search).has("no-sources") ? [] : SOURCES),
  add_source: () =>
    Promise.reject<AppError>({ kind: "invalid", message: "Adding a source needs the real app." }),
  // The picker is the system's, so outside Tauri there is nothing to open and nothing chosen.
  pick_folder: () => null,
  rename_source: () => null,
  set_source_kind: () => null,
  reveal_source: () => null,
  remove_source: () => null,
  reveal_folder: () => null,
  reveal_held: () => null,
  read_folder_again: () => null,
  create_folder: () =>
    Promise.reject<AppError>({ kind: "invalid", message: "Making a folder needs the real app." }),
  rename_folder: () => null,
  move_folder: () => null,
  move_items: ({ itemIds, folderId }): ItemsMoved => {
    const to = folderId as number;
    const steps: Step[] = [];
    const refused: Stayed[] = [];
    for (const item of everyItem().filter((one) => (itemIds as number[]).includes(one.id))) {
      if (item.folderId === to) continue;
      if (taken(to, item.diskName, item)) {
        const reason = { kind: "nameTaken" as const, place: folderName(to), folder: false };
        refused.push(stayedIn(item, { ...reason, name: item.diskName }));
        continue;
      }
      steps.push({ op: "move", item, from: item.folderId });
      relocate(item, to);
    }
    return { batch: record(steps), report: { moved: steps.length, refused } };
  },
  rename_item: ({ itemId, name }) => {
    const item = everyItem().find((one) => one.id === itemId);
    const wanted = (name as string).trim();
    if (!item || wanted === item.diskName) return null;
    if (taken(item.folderId, wanted, item)) {
      const place = folderName(item.folderId);
      return Promise.reject<AppError>({
        kind: "refused",
        message: `${place} already has a file named ${wanted}`,
      });
    }
    const from = item.diskName;
    item.diskName = wanted;
    return record([{ op: "rename", item, from, to: wanted }]);
  },
  // The trash is a folder of its own that no place lists yet.
  trash_items: ({ itemIds }): ItemsTrashed => {
    const steps: Step[] = [];
    for (const item of everyItem().filter((one) => (itemIds as number[]).includes(one.id))) {
      steps.push({ op: "trash", item, from: item.folderId });
      relocate(item, TRASH);
    }
    return { batch: record(steps), report: { trashed: steps.length, refused: [] } };
  },
  folder_file_count: () => 0,
  delete_folder: () => ({ batch: null, report: { deleted: false, refused: [] } }),
  undo_last: () => (journal.length > 0 ? takeBack(journal.length - 1) : null),
  undo_batch: ({ batchId }) => {
    const at = journal.findIndex((batch) => batch.batchId === batchId);
    if (at >= 0) return takeBack(at);
    return Promise.reject<AppError>({ kind: "invalid", message: "nothing left to undo here" });
  },
  folder_children: ({ folderId }) => FOLDERS[folderId as number] ?? [],
  list_folders: (): FolderEntry[] => [
    ...SOURCES.map((one) => ({
      id: one.rootFolderId,
      parentId: null,
      sourceId: one.id,
      title: one.title,
    })),
    ...[...PARENTS].map(([id, { parent, title }]) => ({
      id,
      parentId: parent,
      sourceId: crumbs(id).home?.id ?? 0,
      title,
    })),
  ],
  folder_items: ({ folderId }) => ITEMS[folderId as number] ?? [],
  item_tags: () => [],
  item_detail: ({ itemId }) => detail(itemId as number),
  item_path: ({ itemId }) => detail(itemId as number)?.path ?? null,
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

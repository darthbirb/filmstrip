import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Act } from "../ipc/bindings/Act";
import type { Batch } from "../ipc/bindings/Batch";
import type { Contents } from "../ipc/bindings/Contents";
import type { Crumb } from "../ipc/bindings/Crumb";
import type { DestinationKey } from "../ipc/bindings/DestinationKey";
import type { FavouritePlace } from "../ipc/bindings/FavouritePlace";
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
import type { Trashed } from "../ipc/bindings/Trashed";
import type { TrashSummary } from "../ipc/bindings/TrashSummary";
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
    favorite: false,
  };
}

function folder(id: number, title: string, childCount: number, itemCount: number): FolderNode {
  return { id, title, childCount, itemCount, favorite: false };
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

let nextFolderId = 100;

/** Each live folder's parent and title, read off the tree from each source's own folder down. */
function parents() {
  const found = new Map<number, { parent: number; title: string }>();
  const walk = (parent: number) => {
    for (const child of FOLDERS[parent] ?? []) {
      found.set(child.id, { parent, title: child.title });
      walk(child.id);
    }
  };
  for (const one of SOURCES) walk(one.rootFolderId);
  return found;
}

/** Where the mock keeps what was sent to the trash: a folder no place shows. */
const TRASH = -1;

/** Destination keys: the digit, and the folder it names with the path it last had. */
const KEYS = new Map<
  string,
  { folderId: number; path: Crumb[]; sourceId: number; reachable: boolean }
>();
/** 1 to 9, then 0, as the keys sit on the keyboard. */
const keyOrder = (key: string) => (key === "0" ? 10 : Number(key));

const everyItem = () =>
  Object.entries(ITEMS).flatMap(([folder, rows]) => (Number(folder) === TRASH ? [] : rows));

/** Everything, the trash's too. */
const allItems = () => Object.values(ITEMS).flat();

/** What the trash holds: when each went, and the folder it left, named as it was then. */
type Trashing = { at: number; folders: Crumb[]; home: SourceSummary };
const trashed = new Map<number, Trashing>();
/** Now, in seconds, and one later than the last file sent, so the newest is always first. */
let lastTrashed = 0;

/** Every file in a folder and the folders under it. */
function under(folderId: number): ItemRow[] {
  return [
    ...(ITEMS[folderId] ?? []),
    ...(FOLDERS[folderId] ?? []).flatMap((child) => under(child.id)),
  ];
}

/** From the source's own folder down to this one, and the source it is in. */
function crumbs(folderId: number) {
  const PARENTS = parents();
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
  const row = allItems().find((item) => item.id === itemId);
  if (!row) return null;
  const gone = trashed.get(row.id);
  const { folders, home } = gone ?? crumbs(row.folderId);
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
    trashedAt: gone?.at ?? null,
    sourceId: home.id,
    sourceKind: home.kind,
    folders,
    path: gone
      ? `D:\\Filmstrip\\data\\trash\\${row.uuid}\\${row.diskName}`
      : [home.root, ...folders.slice(1).map((crumb) => crumb.title), row.diskName].join("\\"),
  };
}

/** The mock has no files, so every path it hands out is drawn: a wash in the item's own shape. */
function drawn(path: string) {
  const item = allItems().find((row) => row.thumb === path || path.endsWith(`\\${row.diskName}`));
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
  | { op: "rename"; item: ItemRow; from: string; to: string }
  | { op: "createFolder"; node: FolderNode; parent: number }
  | { op: "renameFolder"; node: FolderNode; from: string; to: string }
  | { op: "moveFolder"; node: FolderNode; from: number; to: number }
  | { op: "deleteFolder"; node: FolderNode; parent: number }
  | { op: "restore"; item: ItemRow; left: number; to: number; went: Trashing };
const journal: { batchId: string; steps: Step[] }[] = [];
let nextBatch = 1;

const folderName = (id: number) => crumbs(id).folders.at(-1)?.title ?? "";

/** Every count in the tree, made true again after a change. */
function recount() {
  for (const node of Object.values(FOLDERS).flat()) {
    node.childCount = FOLDERS[node.id]?.length ?? 0;
    node.itemCount = ITEMS[node.id]?.length ?? 0;
  }
}

/** Puts an item in another folder. */
function relocate(item: ItemRow, to: number) {
  const from = item.folderId;
  ITEMS[from] = (ITEMS[from] ?? []).filter((other) => other !== item);
  item.folderId = to;
  ITEMS[to] = [...(ITEMS[to] ?? []), item];
  recount();
}

/** Sends an item to the trash. It keeps its folder, as the Rust side's row does. */
function toTrash(item: ItemRow) {
  const { folders, home } = crumbs(item.folderId);
  if (home) {
    lastTrashed = Math.max(lastTrashed + 1, Math.floor(Date.now() / 1000));
    trashed.set(item.id, { at: lastTrashed, folders, home });
  }
  ITEMS[item.folderId] = (ITEMS[item.folderId] ?? []).filter((other) => other !== item);
  ITEMS[TRASH] = [...(ITEMS[TRASH] ?? []), item];
  recount();
}

/** A folder that is there: a source's own, or one under it. */
const liveFolder = (id: number) =>
  SOURCES.some((one) => one.rootFolderId === id) || parents().has(id);

/** Takes an item out of the trash into a folder. */
function fromTrash(item: ItemRow, to: number) {
  ITEMS[TRASH] = (ITEMS[TRASH] ?? []).filter((other) => other !== item);
  trashed.delete(item.id);
  item.folderId = to;
  ITEMS[to] = [...(ITEMS[to] ?? []), item];
  recount();
}

/** Puts a folder, with everything under it, inside another, in name order. */
function attach(node: FolderNode, parent: number) {
  FOLDERS[parent] = [...(FOLDERS[parent] ?? []), node].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
  recount();
}

function detach(node: FolderNode) {
  for (const [parent, children] of Object.entries(FOLDERS)) {
    FOLDERS[Number(parent)] = children.filter((child) => child !== node);
  }
  recount();
}

function taken(folderId: number, name: string, item: ItemRow) {
  const lower = name.toLowerCase();
  return (ITEMS[folderId] ?? []).some((o) => o !== item && o.diskName.toLowerCase() === lower);
}

function folderTaken(parent: number, title: string, node?: FolderNode) {
  const lower = title.toLowerCase();
  return (FOLDERS[parent] ?? []).some((o) => o !== node && o.title.toLowerCase() === lower);
}

/** A name already there, refused as the Rust side refuses it, reason and all. */
function refusedName(parent: number, name: string, folder: boolean) {
  const place = folderName(parent);
  return Promise.reject<AppError>({
    kind: "refused",
    message: `${place} already has a ${folder ? "folder" : "file"} named ${name}`,
    reason: { kind: "nameTaken", place, name, folder },
  });
}

const pathOf = (folderId: number) => crumbs(folderId).folders.map((crumb) => crumb.title);

function stayedIn(item: ItemRow, reason: Reason): Stayed {
  const at = { kind: "folder" as const, folderId: item.folderId, path: pathOf(item.folderId) };
  return { kind: "file", id: item.id, name: item.diskName, at, reason };
}

function stayedFolder(node: FolderNode, parent: number, reason: Reason): Stayed {
  const at = { kind: "folder" as const, folderId: parent, path: pathOf(parent) };
  return { kind: "folder", id: node.id, name: node.title, at, reason };
}

function describe(batchId: string, steps: Step[]): Batch {
  const files = steps.reduce(
    (sum, step) =>
      sum + ("item" in step ? 1 : step.op === "moveFolder" ? under(step.node.id).length : 0),
    0,
  );
  const folders = steps.filter((step) => !("item" in step)).length;
  return { batchId, act: act(steps), files, folders };
}

function act(steps: Step[]): Act {
  const gone = steps.find((step) => step.op === "deleteFolder");
  if (gone) {
    const moved = steps.find((step) => step.op === "move" || step.op === "moveFolder");
    const into =
      moved?.op === "move"
        ? folderName(moved.item.folderId)
        : moved?.op === "moveFolder"
          ? folderName(moved.to)
          : null;
    return { kind: "deleteFolder", name: gone.node.title, parent: folderName(gone.parent), into };
  }
  const [first] = steps;
  const restores = steps.filter((step) => step.op === "restore");
  if (restores.length > 0) {
    const homes = new Set(restores.map((step) => step.to));
    const [home] = homes;
    const one = steps.length === 1 && first?.op === "restore" ? first.item.diskName : null;
    return { kind: "restore", to: homes.size === 1 ? folderName(home ?? 0) : null, one };
  }
  if (first?.op === "createFolder")
    return { kind: "createFolder", name: first.node.title, parent: folderName(first.parent) };
  if (first?.op === "renameFolder") return { kind: "renameFolder", from: first.from, to: first.to };
  if (first?.op === "rename") return { kind: "renameFile", from: first.from, to: first.to };
  if (first?.op === "moveFolder" && steps.length === 1) {
    const { node, from, to } = first;
    return { kind: "moveFolder", name: node.title, from: folderName(from), to: folderName(to) };
  }
  const from = new Set(
    steps.map((step) =>
      step.op === "move" || step.op === "trash" || step.op === "moveFolder" ? step.from : 0,
    ),
  );
  const only = from.size === 1 ? folderName([...from][0] ?? 0) : null;
  const files = steps.flatMap((step) => ("item" in step ? [step.item] : []));
  const one = steps.length === 1 ? (files[0]?.diskName ?? null) : null;
  if (first?.op === "trash") return { kind: "delete", from: only, one };
  const to = steps.map((step) =>
    step.op === "move" ? step.item.folderId : step.op === "moveFolder" ? step.to : 0,
  )[0];
  return { kind: "move", from: only, to: folderName(to ?? 0), one };
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
    switch (step.op) {
      case "move":
        relocate(step.item, step.from);
        break;
      case "trash":
        fromTrash(step.item, step.from);
        break;
      case "rename":
        step.item.diskName = step.from;
        break;
      case "createFolder":
        detach(step.node);
        break;
      case "renameFolder":
        step.node.title = step.from;
        break;
      case "moveFolder":
        detach(step.node);
        attach(step.node, step.from);
        break;
      case "deleteFolder":
        attach(step.node, step.parent);
        break;
      case "restore":
        toTrash(step.item);
        step.item.folderId = step.left;
        trashed.set(step.item.id, step.went);
        break;
    }
  }
  return { batch, filesBack: batch.files, foldersBack: batch.folders, stayed: [] };
}

/** The live folder with this id, and the folder it is in. */
function live(folderId: number) {
  const at = parents().get(folderId);
  const node = at && FOLDERS[at.parent]?.find((child) => child.id === folderId);
  return at && node ? { node, parent: at.parent } : null;
}

const invalid = (message: string) => Promise.reject<AppError>({ kind: "invalid", message });

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
  create_folder: ({ parentId, title }) => {
    const parent = parentId as number;
    const name = (title as string).trim();
    if (folderTaken(parent, name)) return refusedName(parent, name, true);
    const node = folder(nextFolderId++, name, 0, 0);
    attach(node, parent);
    return { folderId: node.id, batch: record([{ op: "createFolder", node, parent }]) };
  },
  rename_folder: ({ folderId, title }) => {
    const found = live(folderId as number);
    if (!found) return invalid("a source's own folder is renamed as a source");
    const { node, parent } = found;
    const name = (title as string).trim();
    if (name === node.title) return null;
    if (folderTaken(parent, name, node)) return refusedName(parent, name, true);
    const from = node.title;
    node.title = name;
    detach(node);
    attach(node, parent);
    return record([{ op: "renameFolder", node, from, to: name }]);
  },
  move_folder: ({ folderId, parentId }) => {
    const found = live(folderId as number);
    const to = parentId as number;
    if (!found) return invalid("a source's own folder sits inside nothing");
    const { node, parent } = found;
    if (parent === to) return null;
    if (crumbs(to).folders.some((crumb) => crumb.id === node.id))
      return invalid("a folder cannot go inside itself");
    if (folderTaken(to, node.title)) return refusedName(to, node.title, true);
    detach(node);
    attach(node, to);
    return record([{ op: "moveFolder", node, from: parent, to }]);
  },
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
    if (taken(item.folderId, wanted, item)) return refusedName(item.folderId, wanted, false);
    const from = item.diskName;
    item.diskName = wanted;
    return record([{ op: "rename", item, from, to: wanted }]);
  },
  // The trash is a folder of its own that no place lists yet.
  trash_items: ({ itemIds }): ItemsTrashed => {
    const steps: Step[] = [];
    for (const item of everyItem().filter((one) => (itemIds as number[]).includes(one.id))) {
      steps.push({ op: "trash", item, from: item.folderId });
      toTrash(item);
    }
    return { batch: record(steps), report: { trashed: steps.length, refused: [] } };
  },
  restore_items: ({ itemIds, folderId }) => {
    const steps: Step[] = [];
    const refused: Stayed[] = [];
    const wanted = itemIds as number[];
    for (const item of (ITEMS[TRASH] ?? []).filter((one) => wanted.includes(one.id))) {
      const went = trashed.get(item.id);
      const to = (folderId as number | null) ?? item.folderId;
      const at = { kind: "trash" as const };
      const stayed = (reason: Reason) =>
        refused.push({ kind: "file", id: item.id, name: item.diskName, at, reason });
      if (!went || !liveFolder(to)) {
        stayed({ kind: "folderGone", name: went?.folders.at(-1)?.title ?? "" });
      } else if (taken(to, item.diskName, item)) {
        const place = folderName(to);
        stayed({ kind: "nameTaken", place, name: item.diskName, folder: false });
      } else {
        steps.push({ op: "restore", item, left: item.folderId, to, went });
        fromTrash(item, to);
      }
    }
    return { batch: record(steps), report: { restored: steps.length, refused } };
  },
  folder_file_count: ({ folderId }) => under(folderId as number).length,
  // Everything under the folder goes where `contents` says, then the folder, as the Rust side does.
  delete_folder: ({ folderId, contents }) => {
    const found = live(folderId as number);
    if (!found) return invalid("a source's own folder is removed as a source, never deleted");
    const { node, parent } = found;
    const held = under(node.id);
    const how = contents as Contents | null;
    if (held.length > 0 && !how)
      return invalid(`${node.title} holds ${held.length} files, so where they go has to be chosen`);
    const steps: Step[] = [];
    const refused: Stayed[] = [];
    if (held.length > 0 && how?.kind === "trash") {
      for (const item of held) {
        steps.push({ op: "trash", item, from: item.folderId });
        toTrash(item);
      }
    }
    if (held.length > 0 && how?.kind === "moveTo") {
      const to = SOURCES.find((one) => one.id === how.sourceId)?.rootFolderId ?? 0;
      for (const child of [...(FOLDERS[node.id] ?? [])]) {
        if (folderTaken(to, child.title)) {
          const reason = { kind: "nameTaken" as const, place: folderName(to), folder: true };
          refused.push(stayedFolder(child, node.id, { ...reason, name: child.title }));
          continue;
        }
        steps.push({ op: "moveFolder", node: child, from: node.id, to });
        detach(child);
        attach(child, to);
      }
      for (const item of [...(ITEMS[node.id] ?? [])]) {
        if (taken(to, item.diskName, item)) {
          const reason = { kind: "nameTaken" as const, place: folderName(to), folder: false };
          refused.push(stayedIn(item, { ...reason, name: item.diskName }));
          continue;
        }
        steps.push({ op: "move", item, from: item.folderId });
        relocate(item, to);
      }
    }
    if (refused.length === 0) {
      detach(node);
      steps.push({ op: "deleteFolder", node, parent });
    }
    return { batch: record(steps), report: { deleted: refused.length === 0, refused } };
  },
  undo_last: () => (journal.length > 0 ? takeBack(journal.length - 1) : null),
  undo_batch: ({ batchId }) => {
    const at = journal.findIndex((batch) => batch.batchId === batchId);
    if (at >= 0) return takeBack(at);
    return Promise.reject<AppError>({ kind: "invalid", message: "nothing left to undo here" });
  },
  folder_children: ({ folderId }) => FOLDERS[folderId as number] ?? [],
  // A source's favourite is its own folder's, as the Rust side keeps it.
  set_folder_favorite: ({ folderId, favorite }) => {
    const id = folderId as number;
    const node = live(id)?.node;
    if (node) node.favorite = favorite as boolean;
    for (const one of SOURCES) if (one.rootFolderId === id) one.favorite = favorite as boolean;
    return null;
  },
  favourite_places: (): FavouritePlace[] =>
    [
      ...SOURCES.filter((one) => one.kind === "library" && one.favorite).map((one) => ({
        folderId: one.rootFolderId,
        itemCount: ITEMS[one.rootFolderId]?.length ?? 0,
      })),
      ...[...parents().keys()].flatMap((id) => {
        const node = live(id)?.node;
        return node?.favorite ? [{ folderId: id, itemCount: node.itemCount }] : [];
      }),
    ]
      .map(({ folderId, itemCount }) => {
        const { folders, home } = crumbs(folderId);
        return {
          folderId,
          sourceId: home?.id ?? 0,
          path: folders,
          itemCount,
          reachable: home?.reachable ?? false,
        };
      })
      .sort((a, b) =>
        (a.path.at(-1)?.title ?? "").localeCompare(b.path.at(-1)?.title ?? "", undefined, {
          sensitivity: "base",
        }),
      ),
  destination_keys: (): DestinationKey[] =>
    [...KEYS.entries()]
      .sort(([a], [b]) => keyOrder(a) - keyOrder(b))
      .map(([key, held]) => {
        const node = live(held.folderId)?.node;
        const root = SOURCES.find((one) => one.rootFolderId === held.folderId);
        const gone = !node && !root;
        // A folder that went keeps the path it last had, as the retired row keeps its ancestry.
        if (!gone) {
          const { folders, home } = crumbs(held.folderId);
          Object.assign(held, {
            path: folders,
            sourceId: home?.id ?? 0,
            reachable: !!home?.reachable,
          });
        }
        const itemCount = node ? node.itemCount : (ITEMS[held.folderId]?.length ?? 0);
        return { key, ...held, itemCount: gone ? 0 : itemCount, gone };
      }),
  set_destination_key: ({ key, folderId }) => {
    const [digit, id] = [key as string, folderId as number];
    for (const [other, held] of KEYS)
      if (other === digit || held.folderId === id) KEYS.delete(other);
    const { folders, home } = crumbs(id);
    KEYS.set(digit, {
      folderId: id,
      path: folders,
      sourceId: home?.id ?? 0,
      reachable: !!home?.reachable,
    });
    return null;
  },
  remove_destination_key: ({ key }) => {
    KEYS.delete(key as string);
    return null;
  },
  list_folders: (): FolderEntry[] => [
    ...SOURCES.map((one) => ({
      id: one.rootFolderId,
      parentId: null,
      sourceId: one.id,
      title: one.title,
    })),
    ...[...parents()].map(([id, { parent, title }]) => ({
      id,
      parentId: parent,
      sourceId: crumbs(id).home?.id ?? 0,
      title,
    })),
  ],
  folder_items: ({ folderId }) => ITEMS[folderId as number] ?? [],
  trash_listing: (): Trashed[] =>
    (ITEMS[TRASH] ?? [])
      .map((item) => {
        const gone = trashed.get(item.id);
        const from = {
          folderId: item.folderId,
          path: (gone?.folders ?? []).map((crumb) => crumb.title),
          gone: !liveFolder(item.folderId),
        };
        return { ...item, trashedAt: gone?.at ?? 0, from };
      })
      .sort((a, b) => b.trashedAt - a.trashedAt || b.id - a.id),
  trash_summary: (): TrashSummary => {
    const held = ITEMS[TRASH] ?? [];
    return { count: held.length, bytes: held.reduce((sum, item) => sum + item.sizeBytes, 0) };
  },
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
  copy_items: () => null,
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

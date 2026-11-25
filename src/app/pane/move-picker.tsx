import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { FolderEntry } from "../../ipc/bindings/FolderEntry";
import type { Moved } from "../../ipc/bindings/Moved";
import {
  type AppError,
  folderDetail,
  listFolders,
  moveFolder,
  moveItems,
  setDestinationKey,
} from "../../ipc/commands";
import type { MenuAnchor } from "../../ui/Menu";
import { Picker, type PickerRow, type PickerSection } from "../../ui/Picker";
import { libraryChanged } from "../library";
import { setNews } from "../navigation/foot-slot";
import { getIndex, refreshIndex, useIndex } from "../navigation/index-store";
import type { Place } from "../place";
import { getPreferences, RECENT, updatePreferences, usePreferences } from "../preferences";
import { movedBannerLine, moveStoppedLine, reasonText } from "../undo/lines";
import { showReport } from "../undo/report-store";
import { afterAct } from "../undo/undo";
import { keepFocusThrough } from "./act-focus";
import { type MoveOn, moveOn, moveOnFrom, moveOnLanded, stillListed } from "./move-on";
import { restoreFiles } from "./restore";

/** A folder to move, with everything in it. */
export type MovingFolder = { id: number; name: string };

/**
 * Files or a folder to move, or files to take out of the Trash; the folder they are in now, or
 * came from, when it is one folder; and what asked for the picker.
 */
export type MoveRequest = (
  | { itemIds: number[]; folderId: number | null }
  | { folder: MovingFolder; folderId: number }
  | { restoring: number[]; folderId: number | null }
  /** A destination key to give a folder: the tree is the same, and nothing moves. */
  | { binding: string; folderId: number | null }
) & {
  anchor: MenuAnchor;
  /** Asked for from inside Settings, whose dialog holds the only part of the window not inert. */
  inDialog?: boolean;
  /** The pane's button that asked, whose namesake on the next file's bar takes the focus. */
  keepFocus?: string;
};

// One picker at a time, opened from the bar or a menu and drawn once at the app's root.
let request: MoveRequest | null = null;
let opened = 0;
const listeners = new Set<() => void>();

export function openMovePicker(next: MoveRequest | null) {
  request = next;
  opened++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Where the picker is drawn: the app's root, and inside Settings for what Settings asks for. */
export function MovePickerHost({ inDialog = false }: { inDialog?: boolean }) {
  const shown = useSyncExternalStore(subscribe, () => request);
  return shown && Boolean(shown.inDialog) === inDialog ? (
    <MovePicker key={opened} request={shown} />
  ) : null;
}

/**
 * Move to…: Recent, then the whole tree, filtered as you type. A folder cannot go inside itself,
 * so its own branch cannot be picked. Pane sheet "Move to…".
 */
function MovePicker({ request }: { request: MoveRequest }) {
  const [folders, setFolders] = useState<FolderEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const { sources } = useIndex();
  const recent = usePreferences().recent ?? [];

  useEffect(() => {
    let live = true;
    listFolders().then(
      (every) => {
        if (!live) return;
        setFolders(every);
        // Open down to the folder the files are in, and it too, so the tree starts where they are.
        const at = request.folderId;
        setOpen(new Set(at === null ? [] : [...ancestors(every, at), at]));
      },
      () => live && setFolders([]),
    );
    return () => {
      live = false;
    };
  }, [request.folderId]);

  if (!folders) return null;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const reachable = new Set((sources ?? []).filter((one) => one.reachable).map((one) => one.id));
  const usable = folders.filter((folder) => reachable.has(folder.sourceId));
  const barred = new Set(
    "folder" in request
      ? [request.folderId, ...branch(folders, request.folder.id)]
      : request.folderId === null
        ? []
        : [request.folderId],
  );
  const parentName = (folder: FolderEntry) =>
    folder.parentId === null ? undefined : byId.get(folder.parentId)?.title;
  const flat = (folder: FolderEntry): PickerRow => ({
    ...row(folder, 0, barred),
    detail: folder.id === request.folderId ? "current" : parentName(folder),
  });

  const sections: PickerSection[] = [];
  const typed = filter.trim().toLowerCase();
  if (typed) {
    sections.push({
      rows: usable.filter((folder) => folder.title.toLowerCase().includes(typed)).map(flat),
    });
  } else {
    const known = recent.flatMap((id) => {
      const folder = byId.get(id);
      return folder && reachable.has(folder.sourceId) ? [flat(folder)] : [];
    });
    if (known.length > 0) sections.push({ heading: "Recent", rows: known });
    sections.push({ rows: tree(usable, open, request.folderId, barred) });
  }

  return (
    <Picker
      label={
        "restoring" in request
          ? "Restore to"
          : "binding" in request
            ? `Folder for Key ${request.binding}`
            : "Move to"
      }
      placeholder="Filter folders"
      anchor={request.anchor}
      sections={sections}
      filter={filter}
      onFilter={setFilter}
      onToggle={(id) => {
        const next = new Set(open);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setOpen(next);
      }}
      onPick={(id) => {
        const to = byId.get(id);
        if (!to) return;
        const act = (done: Promise<unknown>) => {
          if (request.keepFocus) keepFocusThrough(request.keepFocus, done);
        };
        if ("restoring" in request) return act(restoreFiles(request.restoring, to));
        if ("binding" in request) {
          return void setDestinationKey(request.binding, to.id)
            .then(() => refreshIndex())
            .catch(() => undefined);
        }
        if (!("folder" in request)) return act(moveFiles(request.itemIds, to));
        const from = { folderId: request.folderId, path: pathOf(byId, request.folderId) };
        void moveFolderTo(request.folder, to, from);
      }}
      onClose={() => openMovePicker(null)}
    />
  );
}

function row(folder: FolderEntry, depth: number, barred: ReadonlySet<number>): PickerRow {
  return {
    id: folder.id,
    label: folder.title,
    glyph: folder.parentId === null ? "source" : "folder",
    depth,
    disabled: barred.has(folder.id),
  };
}

/** A folder and every folder under it. */
function branch(folders: FolderEntry[], id: number) {
  const found = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && found.has(folder.parentId) && !found.has(folder.id)) {
        found.add(folder.id);
        grew = true;
      }
    }
  }
  return found;
}

/** A folder's names from its source's own folder down, as a stayed row's place is named. */
function pathOf(byId: ReadonlyMap<number, FolderEntry>, id: number) {
  const path: string[] = [];
  for (let at = byId.get(id); at; at = at.parentId === null ? undefined : byId.get(at.parentId)) {
    path.unshift(at.title);
  }
  return path;
}

/** The tree as rows, down through whichever folders are open. */
function tree(
  folders: FolderEntry[],
  open: ReadonlySet<number>,
  current: number | null,
  barred: ReadonlySet<number>,
): PickerRow[] {
  const children = new Map<number | null, FolderEntry[]>();
  for (const folder of folders) {
    children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder]);
  }
  const rows: PickerRow[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const folder of children.get(parent) ?? []) {
      const inside = (children.get(folder.id) ?? []).length > 0;
      rows.push({
        ...row(folder, depth, barred),
        // The tree's rows read as navigation's do; a recent or found row names its parent instead.
        count: { own: folder.itemCount, all: folder.allCount },
        detail: folder.id === current ? "current" : undefined,
        expanded: inside ? open.has(folder.id) : undefined,
      });
      if (inside && open.has(folder.id)) walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function ancestors(folders: FolderEntry[], id: number) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const up: number[] = [];
  for (let at = byId.get(id)?.parentId ?? null; at !== null; at = byId.get(at)?.parentId ?? null) {
    up.push(at);
  }
  return up;
}

/** Where a move goes: a folder, named as navigation names it. */
type Into = Pick<FolderEntry, "id" | "title">;

/**
 * Moves the files and says what happened: the line at the foot for what went, the banner over
 * the grid for what did not; and hands back the report. When the pane's file leaves its place
 * the pane moves on, as after a delete. A move between drives is a job, which says so when it
 * ends, and hands back only that it started. DECISIONS.md "Undo".
 */
export async function moveFiles(itemIds: number[], to: Into) {
  const pane = await moveOnFrom(itemIds);
  const moved = await moveItems(itemIds, to.id).catch(() => null);
  if (!moved) return null;
  remember(to);
  if (moved.kind === "started") {
    if (pane.next === pane.shown) return "started" as const;
    if (pane.origin?.kind === "search") landing.set(moved.jobId, pane);
    else if (await leavesAhead(pane.origin, to)) moveOn(pane, []);
    return "started" as const;
  }
  const { batch, report } = moved;
  if (batch) afterAct(batch, report.refused.length);
  const whole = report.moved + report.refused.length;
  const [first] = report.refused;
  showReport(
    first
      ? {
          sentence: movedBannerLine(
            report.moved,
            whole,
            to.title,
            whole === 1 ? first.name : undefined,
          ),
          rows: report.refused,
          heading: "Not Moved",
          retry: () =>
            void moveFiles(
              report.refused.map((one) => one.id),
              to,
            ),
        }
      : null,
  );
  await moveOnOut(pane);
  await libraryChanged();
  return report;
}

/**
 * The pane moves on once its file has left the place it was shown in: one the place still lists
 * keeps it, as a search still finding it, the Sorting Box holding it or a file already where it
 * was sent does. DECISIONS.md "The pane".
 */
async function moveOnOut(pane: MoveOn) {
  if (pane.next !== pane.shown && !(await stillListed(pane))) moveOn(pane, []);
}

// Moves between drives out of a search, by job, waiting to land before the search is asked.
const landing = new Map<number, MoveOn>();

/**
 * Whether a move between drives takes the file out of its place, judged as it starts: out of a
 * folder always, out of the Sorting Box unless into a sorting source.
 */
async function leavesAhead(origin: Place | null, to: Into) {
  if (origin?.kind !== "sorting") return true;
  const into = await folderDetail(to.id).catch(() => null);
  return getIndex().sources?.find((one) => one.id === into?.sourceId)?.kind !== "sorting";
}

/**
 * Moves a folder with everything in it. One that cannot go is the move's banner, with the folder
 * as its one row; one that went takes you with it if you were in it. DECISIONS.md "Undo".
 */
export async function moveFolderTo(
  folder: MovingFolder,
  to: FolderEntry,
  from: { folderId: number; path: string[] },
) {
  try {
    const batch = await moveFolder(folder.id, to.id);
    remember(to);
    if (batch) afterAct(batch);
    showReport(null);
  } catch (error) {
    const { reason } = (error ?? {}) as AppError;
    if (!reason) return;
    const at = { kind: "folder" as const, ...from };
    showReport({
      sentence: movedBannerLine(0, 1, to.title, folder.name),
      rows: [{ kind: "folder", id: folder.id, name: folder.name, at, reason }],
      heading: "Not Moved",
      retry: () => void moveFolderTo(folder, to, from),
    });
  }
  await libraryChanged();
}

/**
 * How a move of files between drives ended: the Line with Undo for what went, and the banner for
 * what stayed, with Retry. One that stopped on its own says why at the foot. DECISIONS.md "Undo".
 */
export async function afterMoved(moved: Moved) {
  await libraryChanged();
  const pane = landing.get(moved.jobId);
  landing.delete(moved.jobId);
  if (pane) await moveOnLanded(pane);
  const { batch, refused, whole, to, stopped } = moved;
  const into = { id: moved.folderId, title: to };
  const [only] = refused;
  if (only) {
    const went = batch?.files ?? 0;
    const one = went === 0 && refused.length === 1;
    showReport({
      sentence: movedBannerLine(went, whole, to, one ? only.name : undefined),
      rows: refused,
      heading: "Not Moved",
      retry: () =>
        void moveFiles(
          refused.map((row) => row.id),
          into,
        ),
    });
  }
  if (stopped) {
    const why = `${reasonText(stopped)}.`;
    if (batch) afterAct(batch, 0, `${moveStoppedLine(batch, whole, to)} ${why}`);
    else if (only) setNews({ kind: "keyRefused", line: why });
    else setNews({ kind: "keyRefused", line: `${movedBannerLine(0, whole, to)}.`, detail: why });
    return;
  }
  // With nothing moved, the banner turns the line round and the foot says nothing.
  if (!batch) return;
  if (moved.cancelled) afterAct(batch, 0, moveStoppedLine(batch, whole, to));
  else afterAct(batch, refused.length);
}

/** Hears how each move between drives ended. */
export async function watchMoves() {
  await listen<Moved>("move-done", ({ payload }) => void afterMoved(payload)).catch(
    () => undefined,
  );
}

/** The picker's Recent: the newest place first, files and folders alike. */
function remember(to: Pick<FolderEntry, "id">) {
  const recent = getPreferences().recent ?? [];
  updatePreferences({ recent: [to.id, ...recent.filter((id) => id !== to.id)].slice(0, RECENT) });
}

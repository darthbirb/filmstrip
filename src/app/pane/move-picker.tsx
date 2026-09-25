import { useEffect, useState, useSyncExternalStore } from "react";

import type { FolderEntry } from "../../ipc/bindings/FolderEntry";
import { type AppError, listFolders, moveFolder, moveItems } from "../../ipc/commands";
import type { MenuAnchor } from "../../ui/Menu";
import { Picker, type PickerRow, type PickerSection } from "../../ui/Picker";
import { libraryChanged } from "../library";
import { useIndex } from "../navigation/index-store";
import { getPreferences, RECENT, updatePreferences, usePreferences } from "../preferences";
import { movedBannerLine } from "../undo/lines";
import { showReport } from "../undo/report-store";
import { afterAct } from "../undo/undo";
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
) & {
  anchor: MenuAnchor;
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

export function MovePickerHost() {
  const shown = useSyncExternalStore(subscribe, () => request);
  return shown ? <MovePicker key={opened} request={shown} /> : null;
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
      label={"restoring" in request ? "Restore to" : "Move to"}
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
        if ("restoring" in request) return void restoreFiles(request.restoring, to);
        if (!("folder" in request)) return void moveFiles(request.itemIds, to);
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

/**
 * Moves the files and says what happened: the line at the foot for what went, the banner over
 * the grid for what did not. DECISIONS.md "Undo".
 */
export async function moveFiles(itemIds: number[], to: Pick<FolderEntry, "id" | "title">) {
  const moved = await moveItems(itemIds, to.id).catch(() => null);
  if (!moved) return;
  remember(to);
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
  await libraryChanged();
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

/** The picker's Recent: the newest place first, files and folders alike. */
function remember(to: Pick<FolderEntry, "id">) {
  const recent = getPreferences().recent ?? [];
  updatePreferences({ recent: [to.id, ...recent.filter((id) => id !== to.id)].slice(0, RECENT) });
}

import { useEffect, useState, useSyncExternalStore } from "react";

import type { FolderEntry } from "../../ipc/bindings/FolderEntry";
import { listFolders, moveItems } from "../../ipc/commands";
import type { MenuAnchor } from "../../ui/Menu";
import { Picker, type PickerRow, type PickerSection } from "../../ui/Picker";
import { libraryChanged } from "../library";
import { useIndex } from "../navigation/index-store";
import { getPreferences, RECENT, updatePreferences, usePreferences } from "../preferences";
import { movedBannerLine } from "../undo/lines";
import { showReport } from "../undo/report-store";
import { afterAct } from "../undo/undo";

/** Files to move, the folder they are in now, and what asked for the picker. */
export type MoveRequest = { itemIds: number[]; folderId: number; anchor: MenuAnchor };

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

/** Move to…: Recent, then the whole tree, filtered as you type. Pane sheet "Move to…". */
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
        setOpen(new Set([...ancestors(every, request.folderId), request.folderId]));
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
  const parentName = (folder: FolderEntry) =>
    folder.parentId === null ? undefined : byId.get(folder.parentId)?.title;
  const flat = (folder: FolderEntry): PickerRow => ({
    ...row(folder, 0, request.folderId),
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
    sections.push({ rows: tree(usable, open, request.folderId) });
  }

  return (
    <Picker
      label="Move to"
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
        if (to) void moveFiles(request.itemIds, to);
      }}
      onClose={() => openMovePicker(null)}
    />
  );
}

function row(folder: FolderEntry, depth: number, current: number): PickerRow {
  return {
    id: folder.id,
    label: folder.title,
    glyph: folder.parentId === null ? "source" : "folder",
    depth,
    disabled: folder.id === current,
  };
}

/** The tree as rows, down through whichever folders are open. */
function tree(folders: FolderEntry[], open: ReadonlySet<number>, current: number): PickerRow[] {
  const children = new Map<number | null, FolderEntry[]>();
  for (const folder of folders) {
    children.set(folder.parentId, [...(children.get(folder.parentId) ?? []), folder]);
  }
  const rows: PickerRow[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const folder of children.get(parent) ?? []) {
      const inside = (children.get(folder.id) ?? []).length > 0;
      rows.push({
        ...row(folder, depth, current),
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
export async function moveFiles(itemIds: number[], to: FolderEntry) {
  const moved = await moveItems(itemIds, to.id).catch(() => null);
  if (!moved) return;
  const recent = getPreferences().recent ?? [];
  updatePreferences({ recent: [to.id, ...recent.filter((id) => id !== to.id)].slice(0, RECENT) });
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

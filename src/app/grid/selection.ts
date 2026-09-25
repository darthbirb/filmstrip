import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { getFullScreen } from "../pane/full-screen";
import { getPaneItem } from "../pane/pane-store";
import { getPlace, type Place, whenPlaceChanges } from "../place";
import { dragging } from "./drag";

/** The files checked, in the order they were checked, and the one a range runs from. */
export type Selection = { ids: readonly number[]; anchor: number | null };

export const NOTHING: Selection = { ids: [], anchor: null };

/** One box, checked or unchecked; checking it makes it where the next range starts. */
export function toggled(selection: Selection, id: number): Selection {
  if (selection.ids.includes(id)) {
    return { ...selection, ids: selection.ids.filter((one) => one !== id) };
  }
  return { ids: [...selection.ids, id], anchor: id };
}

/**
 * The tiles from the last one checked to this one, in the place's order. It replaces what was
 * checked, or `adds` to it; with nothing checked it runs from `from`. Artboards › Selecting.
 */
export function ranged(
  selection: Selection,
  order: readonly number[],
  id: number,
  adds: boolean,
  from: number | null,
): Selection {
  const start = selection.anchor ?? from ?? id;
  const a = order.indexOf(start);
  const b = order.indexOf(id);
  if (b < 0) return selection;
  const range = a < 0 ? [id] : order.slice(Math.min(a, b), Math.max(a, b) + 1);
  const ids = adds
    ? [...selection.ids, ...range.filter((one) => !selection.ids.includes(one))]
    : range;
  return { ids, anchor: a < 0 ? id : start };
}

/** Only what is still in the grid: a file that leaves it leaves the set. */
export function pruned(selection: Selection, present: ReadonlySet<number>): Selection {
  const ids = selection.ids.filter((id) => present.has(id));
  if (ids.length === selection.ids.length) return selection;
  const anchor =
    selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null;
  return ids.length === 0 ? NOTHING : { ids, anchor };
}

// A selection belongs to the place it was made in and clears when you leave it. A folder renamed
// or moved under you is the same place. Artboards › Selecting.
const placeKey = (place: Place | null) =>
  place?.kind === "folder" ? `folder ${place.path.at(-1)?.id}` : (place?.kind ?? "");

// The place's files as the grid last listed them, which the bar reads its count and size from.
let held: { key: string; selection: Selection; listed: readonly ItemRow[] } = {
  key: placeKey(getPlace()),
  selection: NOTHING,
  listed: [],
};
const listeners = new Set<() => void>();

function set(selection: Selection, listed = held.listed) {
  if (selection === held.selection && listed === held.listed) return;
  held = { ...held, selection, listed };
  for (const listener of listeners) listener();
}

whenPlaceChanges(() => {
  const key = placeKey(getPlace());
  if (key === held.key) return;
  held = { ...held, key };
  set(NOTHING, []);
});

export function getSelection() {
  return held.selection;
}

export function useSelection() {
  return useSyncExternalStore(subscribe, getSelection);
}

export function toggleChecked(id: number) {
  set(toggled(held.selection, id));
}

/**
 * Shift+click, and Ctrl+Shift+click to add; with nothing checked it runs from the pane's file, or
 * from `from`, the tile Shift+arrow left.
 */
export function checkRange(
  order: readonly number[],
  id: number,
  adds: boolean,
  from = getPaneItem(),
) {
  set(ranged(held.selection, order, id, adds, from));
}

/** Every file in the place, the ones scrolled out of sight too. */
export function checkAll(order: readonly number[] = held.listed.map((row) => row.id)) {
  set({ ids: [...order], anchor: held.selection.anchor });
}

/** The checked files as the grid lists them, in the order they were checked. */
export function useChecked(): readonly ItemRow[] {
  const now = useSyncExternalStore(subscribe, () => held);
  return useMemo(() => {
    const byId = new Map(now.listed.map((row) => [row.id, row]));
    return now.selection.ids.flatMap((id) => byId.get(id) ?? []);
  }, [now]);
}

export function clearChecked() {
  set(NOTHING);
}

/** The one folder a set is in, or none when it spans several, as a set in the Sorting Box can. */
export function oneFolder(rows: readonly { folderId: number }[]) {
  const [first, ...rest] = rows;
  return first && rest.every((row) => row.folderId === first.folderId) ? first.folderId : null;
}

/** What the grid now lists; whatever is checked and no longer in it is dropped. */
export function keepChecked(listed: readonly ItemRow[]) {
  set(pruned(held.selection, new Set(listed.map((row) => row.id))), listed);
}

/**
 * Ctrl+A takes the whole place and Escape clears it, from anywhere but a field or Settings. What
 * is open closes first: a menu, a field, full screen. Artboards › Selecting.
 */
export function useSelectionKeys(order: readonly number[]) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=menu], [popover]")) {
        return;
      }
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape" && !event.ctrlKey && !event.shiftKey) {
        if (getFullScreen() || dragging() || held.selection.ids.length === 0) return;
        clearChecked();
      } else if (event.key.toLowerCase() === "a" && event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        if (order.length > 0) checkAll(order);
      }
    };
    // Before full screen's own Escape, so the press that leaves it is not also the one that clears.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [order]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

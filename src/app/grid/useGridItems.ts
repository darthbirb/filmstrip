import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import type { ItemRow } from "../../ipc/bindings/ItemRow";
import type { Progress } from "../../ipc/bindings/Progress";
import { itemsDetail } from "../../ipc/commands";
import { RELOAD_WINDOW_MS, whenLibraryChanges } from "../library";
import { type Place, placeKey } from "../place";
import { placeItems } from "./place-items";
import { useSort } from "./sort";

/** What making a thumbnail changes on a row. */
type Patch = Pick<ItemRow, "thumb" | "scrub" | "width" | "height" | "durationMs">;

/**
 * The items the grid shows for a place, in the order chosen for it, fetched again whenever the
 * library or the order changes. The Trash's are `Trashed` rows, newest first, and a search's are
 * `Hit` rows. Background work patches the tiles whose thumbnails it made, and reads the place
 * again at most once a window, only when it may have changed what the place holds.
 * DECISIONS.md "The grid".
 */
export function useGridItems(place: Place | null) {
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const key = placeKey(place);
  const sort = useSort(place);
  const order = `${sort.key} ${sort.dir} ${sort.seed}`;
  const shown = useRef(key);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the place, whatever object carries it, and the order is the sort.
  useEffect(() => {
    // Reordering keeps the tiles until the new order arrives; only a new place stands them in.
    if (shown.current !== key) setItems(null);
    shown.current = key;
    if (!place) {
      setItems(null);
      return;
    }
    let live = true;
    let asked = 0;
    let newestListing = 0;
    let landedListing = 0;
    const pending = new Map<number, { at: number; patch: Patch }>();
    let listed = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      clearTimeout(timer);
      timer = undefined;
      const at = ++asked;
      newestListing = at;
      const land = (rows: ItemRow[]) => {
        if (!live || at !== newestListing) return;
        landedListing = at;
        listed = new Set(rows.map((row) => row.id));
        const later = new Map<number, Patch>();
        for (const [id, held] of pending) if (held.at > at) later.set(id, held.patch);
        pending.clear();
        setItems(patched(rows, later));
      };
      placeItems(place, sort).then(land, () => land([]));
    };

    const soon = () => {
      if (timer === undefined) timer = setTimeout(load, RELOAD_WINDOW_MS);
    };

    const refresh = (made: number[]) => {
      const settled = newestListing === landedListing;
      const ids = settled ? made.filter((id) => listed.has(id)) : made;
      if (ids.length === 0) return;
      const at = ++asked;
      itemsDetail(ids).then(
        (details) => {
          if (!live || at < landedListing) return;
          const fresh = patchesOf(details);
          if (newestListing > landedListing)
            for (const [id, patch] of fresh) pending.set(id, { at, patch });
          setItems((rows) => rows && patched(rows, fresh));
        },
        () => undefined,
      );
    };

    let before: Progress | null = null;
    load();
    const unlisten = listen<Progress | null>("job-progress", ({ payload }) => {
      const thumbed = payload?.thumbed ?? [];
      if (thumbed.length > 0) refresh(thumbed);
      if (mayHaveMoved(payload, before)) soon();
      before = payload ?? null;
    }).catch(() => undefined);
    const stop = whenLibraryChanges(load);
    return () => {
      live = false;
      clearTimeout(timer);
      stop();
      void unlisten.then((stop) => stop?.());
    };
  }, [key, order]);

  return items;
}

/**
 * Whether a report says files may have come, gone or moved: a walk under way or just ended, a
 * copy or a move moving on, or the queue starting or settling. Thumbnails alone never do.
 */
function mayHaveMoved(now: Progress | null | undefined, before: Progress | null) {
  if (!now) return true;
  if (now.phase === "walking") return true;
  if (!before) return now.copies.length > 0 || now.moves.length > 0;
  return (
    now.phase !== before.phase ||
    now.walks !== before.walks ||
    JSON.stringify(now.copies) !== JSON.stringify(before.copies) ||
    JSON.stringify(now.moves) !== JSON.stringify(before.moves)
  );
}

function patchesOf(details: (ItemDetail | null)[]) {
  const patches = new Map<number, Patch>();
  for (const detail of details) {
    if (!detail) continue;
    const { thumb, scrub, width, height, durationMs } = detail;
    patches.set(detail.id, { thumb, scrub, width, height, durationMs });
  }
  return patches;
}

/** The rows with each patch laid over its own, and the same array when none is there. */
function patched(rows: ItemRow[], patches: Map<number, Patch>) {
  if (patches.size === 0) return rows;
  let changed = false;
  const next = rows.map((row) => {
    const patch = patches.get(row.id);
    if (!patch) return row;
    changed = true;
    return { ...row, ...patch };
  });
  return changed ? next : rows;
}

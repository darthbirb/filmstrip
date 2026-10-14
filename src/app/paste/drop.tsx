import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useSyncExternalStore } from "react";

import type { Carried } from "../../ipc/bindings/Carried";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { countCarried } from "../../ipc/commands";
import { DragGhost } from "../../ui/DragGhost";
import { ContextMenu } from "../../ui/Menu";
import { getIndex } from "../navigation/index-store";
import { type Crumb, getPlace } from "../place";
import { counted } from "./clipboard";
import { dropInto, type Into, openPick, sortingPlaces, usePick } from "./copy";

// Files dragged in from Explorer: the app's own ghost says the act before it lands, over a row or
// a folder's grid, and letting go copies them in. Artboards › Bringing files in.

/** What a row or the grid does with files from Explorer: takes them, asks which, or says why not. */
export type Landing =
  | { kind: "accept"; to: Into; open?: () => void }
  | { kind: "pick"; places: Into[] }
  | { kind: "refuse"; why: string };

/** Navigation's answer for each of its rows; null for a row that is no place to land. */
export type Resolver = (rowId: string, paths: readonly string[]) => Landing | null;

type Over = { rowId: string | null; landing: Landing };
type Outside = {
  paths: string[];
  carried: Carried | null;
  x: number;
  y: number;
  over: Over | null;
};

let resolve: Resolver = () => null;
let drag: Outside | null = null;
const listeners = new Set<() => void>();

export function setOutsideResolver(next: Resolver) {
  resolve = next;
}

export function useOutsideDrag() {
  return useSyncExternalStore(subscribe, () => drag);
}

function set(next: Outside | null) {
  drag = next;
  for (const listener of listeners) listener();
}

const key = (path: string) =>
  path
    .replace(/[\\/]+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
const parentKey = (path: string) => key(path).replace(/\/[^/]*$/, "");
const baseName = (path: string) =>
  path
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1) ?? path;

/**
 * Whether a folder takes files from Explorer: not on a drive that is away, not a folder carried
 * into itself, and not files that are all already there.
 */
export function landingInto(
  source: SourceSummary,
  path: readonly Crumb[],
  paths: readonly string[],
  open?: () => void,
): Landing {
  const folder = path.at(-1) ?? { id: source.rootFolderId, title: source.title };
  if (!source.reachable) return { kind: "refuse", why: `${source.title} is offline` };
  const dir = key([source.root, ...path.slice(1).map((crumb) => crumb.title)].join("\\"));
  const itself = paths.find((one) => dir === key(one) || dir.startsWith(`${key(one)}/`));
  if (itself) return { kind: "refuse", why: `${baseName(itself)} cannot go inside itself` };
  if (paths.length > 0 && paths.every((one) => parentKey(one) === dir)) {
    return { kind: "refuse", why: `Already in ${folder.title}` };
  }
  return { kind: "accept", to: { id: folder.id, title: folder.title }, open };
}

/** The Sorting Box takes a drop into its one sorting source, or asks which when it has more. */
export function sortingLanding(
  sources: readonly SourceSummary[],
  paths: readonly string[],
): Landing | null {
  const sorting = sources.filter((source) => source.kind === "sorting");
  const [one] = sorting;
  if (!one) return null;
  if (sorting.length > 1) return { kind: "pick", places: sortingPlaces(sorting) };
  return landingInto(one, [{ id: one.rootFolderId, title: one.title }], paths);
}

/** The grid is the place it shows: a folder's or the Sorting Box's; a search and the Trash take nothing. */
function gridLanding(paths: readonly string[]): Landing | null {
  const place = getPlace();
  const sources = getIndex().sources ?? [];
  if (place?.kind === "sorting") return sortingLanding(sources, paths);
  if (place?.kind !== "folder") return null;
  const source = sources.find((one) => one.id === place.sourceId);
  return source ? landingInto(source, place.path, paths) : null;
}

/** A token's duration in milliseconds. */
function hold() {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hold"));
}

let holding: ReturnType<typeof setTimeout> | undefined;

/** Where the pointer rests, in the window's pixels, and what lies there. */
function track(x: number, y: number) {
  if (!drag) return;
  const under = document.elementFromPoint(x, y);
  const row = under?.closest<HTMLElement>("[data-row]")?.dataset.row ?? null;
  const onGrid = row === null && Boolean(under?.closest("[data-drop=grid]"));
  const landing = row !== null ? resolve(row, drag.paths) : onGrid ? gridLanding(drag.paths) : null;
  const over = landing ? { rowId: row, landing } : null;
  if (over?.rowId !== drag.over?.rowId || (over === null) !== (drag.over === null)) {
    clearTimeout(holding);
    const open = over?.landing.kind === "accept" ? over.landing.open : undefined;
    if (open) holding = setTimeout(open, hold());
  }
  set({ ...drag, x, y, over });
}

/** Letting go: the copy, or the Sorting Box's question at the pointer. */
function land(x: number, y: number) {
  track(x, y);
  const was = drag;
  clearTimeout(holding);
  set(null);
  const landing = was?.over?.landing;
  if (!was || !landing) return;
  if (landing.kind === "accept") void dropInto(landing.to, was.paths);
  if (landing.kind === "pick") {
    const what = was.carried ? counted(was.carried, true) : "Files";
    openPick({
      heading: `Copy ${what} To`,
      anchor: { x, y },
      places: landing.places,
      onPick: (to) => void dropInto(to, was.paths),
    });
  }
}

/** Follows drags from Explorer over the window; a drop from Explorer is always a copy. */
export function useExplorerDrops() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    const at = (position: { x: number; y: number }) => {
      const scale = window.devicePixelRatio || 1;
      return [position.x / scale, position.y / scale] as const;
    };
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") {
          clearTimeout(holding);
          set(null);
          return;
        }
        const [x, y] = at(payload.position);
        if (payload.type === "enter") {
          const paths = [...payload.paths];
          set({ paths, carried: null, x, y, over: null });
          void countCarried(paths)
            .then((carried) => {
              if (drag?.paths === paths) set({ ...drag, carried });
            })
            .catch(() => undefined);
          track(x, y);
        } else if (payload.type === "over") track(x, y);
        else land(x, y);
      })
      .then((unlisten) => {
        if (gone) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
}

/** The ghost under Explorer's own picture: the hatch where a picture will be, and the act. */
export function ExplorerGhost() {
  const now = useOutsideDrag();
  if (!now) return null;
  const landing = now.over?.landing;
  const what = now.carried ? counted(now.carried) : `${now.paths.length}`;
  const label =
    landing?.kind === "accept"
      ? `Copy ${what} to ${landing.to.title}`
      : landing?.kind === "pick"
        ? `Copy ${what} to…`
        : landing?.kind === "refuse"
          ? landing.why
          : what;
  return (
    <DragGhost
      x={now.x}
      y={now.y}
      stacked={now.paths.length > 1}
      refused={landing?.kind === "refuse"}
      label={label}
    />
  );
}

/** The Sorting Box's sources, asked against its row or at the pointer; the pick is the act. */
export function PickHost() {
  const pick = usePick();
  if (!pick) return null;
  return (
    <ContextMenu
      label={pick.heading}
      heading={pick.heading}
      anchor={pick.anchor}
      groups={[
        pick.places.map((place) => ({
          id: `pick-${place.id}`,
          label: place.title,
          glyph: "sortingBox" as const,
          filled: true,
          onSelect: () => pick.onPick(place),
        })),
      ]}
      onClose={() => openPick(null)}
    />
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

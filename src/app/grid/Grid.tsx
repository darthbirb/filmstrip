import { convertFileSrc } from "@tauri-apps/api/core";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import type { Origin } from "../../ipc/bindings/Origin";
import type { Trashed } from "../../ipc/bindings/Trashed";
import { formatDay, formatDuration } from "../../lib/format";
import { useContextMenu } from "../../ui/Menu";
import { SelectBox } from "../../ui/SelectBox";
import { SkeletonTile } from "../../ui/Skeleton";
import { THUMB_FRAME, ThumbFace } from "../../ui/Thumb";
import { itemMenu } from "../menus/item-menu";
import { setFullScreen } from "../pane/full-screen";
import { showInPane, usePaneItem } from "../pane/pane-store";
import { type Place, usePlace } from "../place";
import { usePreferences } from "../preferences";
import { EmptyPlace } from "./EmptyPlace";
import { rowOf, step } from "./keys";
import { type LayoutMode, rowAt } from "./layout";
import {
  checkRange,
  keepChecked,
  toggleChecked,
  useSelection,
  useSelectionKeys,
} from "./selection";
import { tileSize } from "./TileSize";
import { useGridItems } from "./useGridItems";
import { useLayout } from "./useLayout";

/** The current place's pictures, laid out in rows and drawn only where they can be seen. */
export function Grid({ mode }: { mode: LayoutMode }) {
  const place = usePlace();
  const items = useGridItems(place);
  const inPane = usePaneItem();
  const { tile } = usePreferences();
  const scroller = useRef<HTMLDivElement>(null);
  const view = useViewport(scroller);
  const gap = view.gap;
  const rowHeight = tileSize(tile) * view.rem;
  // The Trash runs newest first under a heading per day, each tile saying where it came from.
  // Only once its own rows have come: the place changes a render before the items do.
  const trashed =
    place?.kind === "trash" && items?.every((item) => "trashedAt" in item)
      ? (items as Trashed[])
      : null;
  const days = useMemo(() => (trashed ? byDay(trashed) : null), [trashed]);
  const sections = useMemo(
    () => days && { groups: days.starts, lead: view.heading + gap, below: view.caption },
    [days, view.heading, view.caption, gap],
  );
  const result = useLayout(items ?? [], view.width - gap * 2, rowHeight, gap, mode, sections);
  const reading = place !== null && items === null;
  const selection = useSelection();
  const checked = new Set(selection.ids);
  const order = useMemo(() => (items ?? []).map((item) => item.id), [items]);
  const indexOf = useMemo(() => new Map(order.map((id, index) => [id, index])), [order]);
  useSelectionKeys(order);

  // The grid is one tab stop: the tile the ring is on, else the one in the pane, else the first.
  const [ringed, setRinged] = useState<number | null>(null);
  const ring = [ringed, inPane, order[0]].find((id) => id != null && indexOf.has(id)) ?? null;
  const focusing = useRef<number | null>(null);

  // A file that leaves the grid leaves the set. Artboards › Selecting.
  useEffect(() => {
    if (items) keepChecked(order);
  }, [items, order]);

  // Once the ring has moved, its tile scrolls into view and takes the focus.
  useLayoutEffect(() => {
    const id = focusing.current;
    const element = scroller.current;
    const index = id === null ? undefined : indexOf.get(id);
    if (index === undefined || !element || !result) return;
    focusing.current = null;
    const row = rowOf(result, index);
    const top = (result.rowTops[row] ?? 0) + gap;
    const bottom = top + (result.rowHeights[row] ?? 0) + (sections?.below ?? 0);
    if (top - gap < element.scrollTop) element.scrollTop = top - gap;
    else if (bottom + gap > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom + gap - element.clientHeight;
    }
    element.querySelector<HTMLElement>(`[data-item="${id}"]`)?.focus({ preventScroll: true });
  });

  // The arrows move the ring and nothing else; Space is the box and Enter shows the tile.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const from = Number(target?.dataset.item);
    const index = indexOf.get(from);
    if (index === undefined || !result || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) return;
      if (event.key === " ") toggleChecked(from);
      else showInPane(from, place);
      return;
    }
    const next = step(result, order.length, index, event.key, view.height);
    const to = next === null ? undefined : order[next];
    if (to === undefined) return;
    event.preventDefault();
    if (event.shiftKey) checkRange(order, to, false, from);
    setRinged(to);
    focusing.current = to;
  };

  // A modified click changes only the set, and the pane stays where it is.
  const check = (event: MouseEvent, id: number) => {
    if (event.shiftKey) checkRange(order, id, event.ctrlKey);
    else toggleChecked(id);
  };

  const tiles: ReactElement[] = [];
  if (items && result) {
    const draw = (index: number, row: number) => {
      const item = items[index];
      if (!item) return;
      tiles.push(
        <Tile
          key={item.id}
          item={item}
          from={place}
          shown={item.id === inPane}
          checked={checked.has(item.id)}
          boxes={checked.size > 0}
          ringed={item.id === ring}
          onCheck={check}
          onRing={setRinged}
          onKeyDown={onKeyDown}
          left={(result.itemLeft[index] ?? 0) + gap}
          top={(result.rowTops[row] ?? 0) + gap}
          width={result.itemWidth[index] ?? 0}
          height={result.rowHeights[row] ?? 0}
          origin={trashed?.[index]?.from}
          below={sections?.below ?? 0}
        />,
      );
    };
    // A screen's height above and below is drawn ahead of the scroll, so a fling never shows gaps.
    const first = rowAt(result.rowTops, result.rows, view.top - view.height);
    const last = Math.min(
      rowAt(result.rowTops, result.rows, view.top + view.height * 2),
      result.rows - 1,
    );
    for (let row = first; row <= last; row += 1) {
      const start = result.rowStart[row] ?? 0;
      const end = Math.min(start + (result.rowLength[row] ?? 0), items.length);
      for (let index = start; index < end; index += 1) draw(index, row);
    }
    // The ringed tile is drawn wherever the scroll is, so the focus is never dropped with it.
    const at = ring === null ? undefined : indexOf.get(ring);
    if (at !== undefined) {
      const row = rowOf(result, at);
      if (row < first || row > last) draw(at, row);
    }
  }

  return (
    <div ref={scroller} aria-busy={reading || undefined} className="h-full overflow-auto">
      {reading ? (
        <Reading
          width={view.width}
          height={view.height}
          rowHeight={rowHeight}
          gap={gap}
          mode={mode}
        />
      ) : items?.length === 0 && place ? (
        <EmptyPlace place={place} />
      ) : (
        <div
          className="relative"
          style={{ height: result && items?.length ? result.totalHeight + gap * 2 : 0 }}
        >
          {/* Drawn once the layout that made room for them has come back. */}
          {result?.groupTops.length === days?.headings.length &&
            days?.headings.map((day, group) => (
              <h3
                key={day}
                className="absolute m-0 flex h-heading items-end px-0.5 text-eyebrow text-fg-dim uppercase"
                style={{ top: (result?.groupTops[group] ?? 0) + gap, left: gap, right: gap }}
              >
                {day}
              </h3>
            ))}
          {tiles}
        </div>
      )}
    </div>
  );
}

/** Where each day's run begins, newest first, and the heading it goes under. */
function byDay(items: readonly Trashed[]) {
  const starts: number[] = [];
  const headings: string[] = [];
  items.forEach((item, index) => {
    const day = formatDay(item.trashedAt);
    if (day === headings.at(-1)) return;
    starts.push(index);
    headings.push(day);
  });
  return { starts: Uint32Array.from(starts), headings };
}

// Common photograph shapes, so the stand-ins look like the rows that replace them.
const STAND_IN_SHAPES = [4 / 3, 3 / 2, 2 / 3, 16 / 9, 1, 3 / 4];

type ReadingProps = {
  width: number;
  height: number;
  rowHeight: number;
  gap: number;
  mode: LayoutMode;
};

/** While a place is read, rows of stand-ins fill the view in the shape of what is coming. */
function Reading({ width, height, rowHeight, gap, mode }: ReadingProps) {
  if (width <= 0 || rowHeight <= 0) return null;
  const count = Math.max(1, Math.ceil(height / (rowHeight + gap)));
  const rows = Array.from({ length: count }, (_, row) => ({
    key: `row-${row}`,
    shapes: standIns(row, width - gap * 2, rowHeight, gap, mode),
  }));
  return (
    <div
      data-testid="reading"
      aria-hidden="true"
      className="flex flex-col"
      style={{ padding: gap, gap }}
    >
      {rows.map((row) => (
        <div key={row.key} className="flex" style={{ height: rowHeight, gap }}>
          {row.shapes.map((shape) => (
            <SkeletonTile key={shape.key} grow={shape.grow} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A row's stand-ins: squares for the uniform layout, else photograph shapes until the row is full. */
function standIns(row: number, width: number, rowHeight: number, gap: number, mode: LayoutMode) {
  const grows: number[] = [];
  if (mode === "uniform") {
    const across = Math.max(1, Math.floor((width + gap) / (rowHeight + gap)));
    for (let at = 0; at < across; at += 1) grows.push(1);
  } else {
    let used = -gap;
    for (let at = row * 2; used < width || grows.length === 0; at += 1) {
      const shape = STAND_IN_SHAPES[at % STAND_IN_SHAPES.length] ?? 1;
      grows.push(shape);
      used += shape * rowHeight + gap;
    }
  }
  return grows.map((grow, at) => ({ key: `${row}-${at}`, grow }));
}

type TileProps = {
  item: ItemRow;
  /** The place it is listed in, which the pane's filmstrip then runs through. */
  from: Place | null;
  /** Whether the pane is showing it. */
  shown: boolean;
  checked: boolean;
  /** Something is checked, so every tile shows its box. */
  boxes: boolean;
  /** The grid's one tab stop. */
  ringed: boolean;
  onCheck: (event: MouseEvent, id: number) => void;
  onRing: (id: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  left: number;
  top: number;
  width: number;
  height: number;
  /** For a file in the Trash: the folder it came from, said under the tile. */
  origin?: Origin;
  /** The room under the tile for that line. */
  below: number;
};

function Tile(props: TileProps) {
  const { item, from, shown, checked, boxes, ringed, onCheck, onRing, onKeyDown } = props;
  const { left, top, width, height, origin, below } = props;
  // Opening it moves nothing: the pane keeps what it shows until a verb says otherwise.
  const context = useContextMenu();
  return (
    <figure
      title={item.diskName}
      className="group/tile absolute m-0"
      style={{ left, top, width, height: height + below }}
    >
      {context.menu}
      <button
        type="button"
        aria-label={item.diskName}
        data-item={item.id}
        tabIndex={ringed ? 0 : -1}
        onFocus={() => onRing(item.id)}
        onKeyDown={onKeyDown}
        onContextMenu={(event) =>
          context.open(
            event,
            item.diskName,
            itemMenu(item, () => showInPane(item.id, from)),
          )
        }
        aria-current={shown || undefined}
        onClick={(event) => {
          if (event.ctrlKey || event.shiftKey) onCheck(event, item.id);
          else showInPane(item.id, from);
        }}
        // Folded or hidden, the pane has no header to hold the control, so the tile is the way in.
        onDoubleClick={(event) => {
          if (event.ctrlKey || event.shiftKey) return;
          showInPane(item.id, from);
          setFullScreen(true);
        }}
        className={`focus-ring block w-full ${THUMB_FRAME}`}
        style={{ height }}
      >
        <ThumbFace
          src={item.thumb ? convertFileSrc(item.thumb) : undefined}
          current={shown}
          duration={
            item.kind === "video" && item.durationMs !== null
              ? formatDuration(item.durationMs)
              : undefined
          }
        />
      </button>
      {/* Clicking the picture shows it; the box is the other target. Components › Selection checkbox. */}
      <SelectBox
        label={`Check ${item.diskName}`}
        checked={checked}
        shown={boxes}
        onClick={(event) => onCheck(event, item.id)}
      />
      {origin && (
        // The folder's name only; its whole path is the tooltip, and the pane's From row.
        <figcaption
          title={origin.path.join(" › ")}
          className="flex h-tile-caption items-end px-0.5 text-small"
        >
          <span className="truncate text-fg-mid">
            {origin.path.at(-1)}
            {origin.gone && <span className="text-fg-dim"> · gone</span>}
          </span>
        </figcaption>
      )}
    </figure>
  );
}

/** The scroller's size and position in pixels, with the root size and the tile gap they turn on. */
function useViewport(ref: RefObject<HTMLElement | null>) {
  const [view, setView] = useState({
    width: 0,
    height: 0,
    top: 0,
    rem: 16,
    gap: 0,
    heading: 0,
    caption: 0,
  });

  useLayoutEffect(() => {
    const scroller = ref.current;
    if (!scroller) return;
    // A 1rem probe resizes with the root font size, which the scroller alone would not report.
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:1rem;height:0";
    document.body.append(probe);
    const measure = () => {
      const rem = probe.getBoundingClientRect().width;
      const root = getComputedStyle(document.documentElement);
      const token = (name: string) => Number.parseFloat(root.getPropertyValue(name)) * rem;
      setView({
        width: scroller.clientWidth,
        height: scroller.clientHeight,
        top: scroller.scrollTop,
        rem,
        gap: token("--spacing-tile-gap"),
        heading: token("--spacing-heading"),
        caption: token("--spacing-tile-caption"),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(probe);
    scroller.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      probe.remove();
      scroller.removeEventListener("scroll", measure);
    };
  }, [ref]);

  return view;
}

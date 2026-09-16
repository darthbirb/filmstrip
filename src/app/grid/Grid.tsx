import { convertFileSrc } from "@tauri-apps/api/core";
import { type ReactElement, type RefObject, useLayoutEffect, useRef, useState } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { formatDuration } from "../../lib/format";
import { SkeletonTile } from "../../ui/Skeleton";
import { THUMB_FRAME, ThumbFace } from "../../ui/Thumb";
import { showInPane, usePaneItem } from "../pane/pane-store";
import { type Place, usePlace } from "../place";
import { usePreferences } from "../preferences";
import { EmptyPlace } from "./EmptyPlace";
import { type LayoutMode, rowAt } from "./layout";
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
  const result = useLayout(items ?? [], view.width - gap * 2, rowHeight, gap, mode);
  const reading = place !== null && items === null;

  const tiles: ReactElement[] = [];
  if (items && result) {
    // A screen's height above and below is drawn ahead of the scroll, so a fling never shows gaps.
    const first = rowAt(result.rowTops, result.rows, view.top - view.height);
    const last = rowAt(result.rowTops, result.rows, view.top + view.height * 2);
    for (let row = first; row <= last && row < result.rows; row += 1) {
      const start = result.rowStart[row] ?? 0;
      const end = start + (result.rowLength[row] ?? 0);
      for (let index = start; index < end && index < items.length; index += 1) {
        const item = items[index];
        if (!item) continue;
        tiles.push(
          <Tile
            key={item.id}
            item={item}
            from={place}
            shown={item.id === inPane}
            left={(result.itemLeft[index] ?? 0) + gap}
            top={(result.rowTops[row] ?? 0) + gap}
            width={result.itemWidth[index] ?? 0}
            height={result.rowHeights[row] ?? 0}
          />,
        );
      }
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
          {tiles}
        </div>
      )}
    </div>
  );
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
  left: number;
  top: number;
  width: number;
  height: number;
};

function Tile({ item, from, shown, left, top, width, height }: TileProps) {
  return (
    <figure title={item.diskName} className="absolute m-0" style={{ left, top, width, height }}>
      <button
        type="button"
        aria-label={item.diskName}
        aria-current={shown || undefined}
        onClick={() => showInPane(item.id, from)}
        className={`focus-ring block size-full ${THUMB_FRAME}`}
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
    </figure>
  );
}

/** The scroller's size and position in pixels, with the root size and the tile gap they turn on. */
function useViewport(ref: RefObject<HTMLElement | null>) {
  const [view, setView] = useState({ width: 0, height: 0, top: 0, rem: 16, gap: 0 });

  useLayoutEffect(() => {
    const scroller = ref.current;
    if (!scroller) return;
    // A 1rem probe resizes with the root font size, which the scroller alone would not report.
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:1rem;height:0";
    document.body.append(probe);
    const measure = () => {
      const rem = probe.getBoundingClientRect().width;
      const gap =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--spacing-tile-gap"),
        ) * rem;
      setView({
        width: scroller.clientWidth,
        height: scroller.clientHeight,
        top: scroller.scrollTop,
        rem,
        gap,
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

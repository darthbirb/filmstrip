import { convertFileSrc } from "@tauri-apps/api/core";
import { type ReactElement, type RefObject, useLayoutEffect, useRef, useState } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { showInPane, usePaneItem } from "../pane/pane-store";
import { usePlace } from "../place";
import { usePreferences } from "../preferences";
import { type LayoutMode, rowAt } from "./layout";
import { tileSize } from "./TileSize";
import { useGridItems } from "./useGridItems";
import { useLayout } from "./useLayout";

/** The current place's pictures, laid out in rows and drawn only where they can be seen. */
export function Grid({ mode }: { mode: LayoutMode }) {
  const items = useGridItems(usePlace());
  const inPane = usePaneItem();
  const { tile } = usePreferences();
  const scroller = useRef<HTMLDivElement>(null);
  const view = useViewport(scroller);
  const gap = view.gap;
  const result = useLayout(items ?? [], view.width - gap * 2, tileSize(tile) * view.rem, gap, mode);

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
    <div ref={scroller} className="h-full overflow-auto">
      {items?.length === 0 && <p className="px-3 py-2 text-fg-muted text-ui">No pictures here.</p>}
      <div
        className="relative"
        style={{ height: result && items?.length ? result.totalHeight + gap * 2 : 0 }}
      >
        {tiles}
      </div>
    </div>
  );
}

type TileProps = {
  item: ItemRow;
  /** Whether the pane is showing it. */
  shown: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
};

function Tile({ item, shown, left, top, width, height }: TileProps) {
  return (
    <figure
      title={item.diskName}
      className="absolute m-0 overflow-hidden bg-hover"
      style={{ left, top, width, height }}
    >
      <button
        type="button"
        aria-label={item.diskName}
        aria-current={shown || undefined}
        onClick={() => showInPane(item.id)}
        className="focus-ring relative block size-full"
      >
        {item.thumb && (
          <img
            src={convertFileSrc(item.thumb)}
            alt=""
            draggable={false}
            decoding="async"
            className="size-full object-cover"
          />
        )}
        {shown && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_var(--focus-width)_var(--color-fg)]"
          />
        )}
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

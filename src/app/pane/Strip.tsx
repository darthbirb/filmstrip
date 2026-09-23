import { convertFileSrc } from "@tauri-apps/api/core";
import {
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { useContextMenu } from "../../ui/Menu";
import { StepButton } from "../../ui/StepButton";
import { THUMB_FRAME, ThumbFace } from "../../ui/Thumb";
import { useGridItems } from "../grid/useGridItems";
import { itemMenu } from "../menus/item-menu";
import type { Place } from "../place";
import { showInPane, usePaneItem, usePaneOrigin } from "./pane-store";

/** A frame for each item in the place the shown one was chosen in, stepped through in order. */
export function Strip() {
  // The item asked for, not the one loaded, so a second step taken mid-load starts from the first.
  const current = usePaneItem();
  const from = usePaneOrigin();
  const items = useGridItems(from);
  if (current === null || !items || items.length < 2) return null;
  return <Track items={items} current={current} from={from} />;
}

type TrackProps = { items: ItemRow[]; current: number; from: Place | null };

function Track({ items, current, from }: TrackProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const cellProbe = useRef<HTMLSpanElement>(null);
  const gapProbe = useRef<HTMLSpanElement>(null);
  const view = useTrackView(scroller, cellProbe, gapProbe);
  const refocus = useRef(false);
  // A frame is a tile, and gets the tile's menu.
  const context = useContextMenu();
  const index = items.findIndex((item) => item.id === current);
  const step = view.cell + view.gap;

  const show = (at: number, byKeyboard = false) => {
    const item = items[Math.min(Math.max(at, 0), items.length - 1)];
    if (!item) return;
    refocus.current = byKeyboard;
    showInPane(item.id, from);
  };

  // The shown frame comes to the middle whenever it changes or the strip is resized.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || step === 0 || index < 0) return;
    element.scrollLeft = view.pad + index * step + view.cell / 2 - view.width / 2;
  }, [index, step, view.pad, view.cell, view.width]);

  // A keyboard step keeps focus on the frame shown, once it is drawn.
  useEffect(() => {
    if (!refocus.current) return;
    const frame = scroller.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!frame) return;
    frame.focus({ preventScroll: true });
    refocus.current = false;
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: items.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    show(target, true);
  };

  const frames: ReactElement[] = [];
  if (step > 0) {
    // A strip's width either side is drawn ahead of the scroll, so a step never shows a gap.
    const first = Math.max(0, Math.floor((view.left - view.width) / step));
    const last = Math.min(items.length - 1, Math.ceil((view.left + view.width * 2) / step));
    const stop = index >= 0 ? index : first;
    const drawn = new Set<number>();
    for (let at = first; at <= last; at += 1) drawn.add(at);
    drawn.add(stop);
    for (const at of drawn) {
      const item = items[at];
      if (!item) continue;
      frames.push(
        <div
          key={item.id}
          className="absolute top-0 h-full aspect-strip"
          style={{ left: at * step }}
        >
          <button
            type="button"
            role="option"
            aria-selected={at === index}
            aria-posinset={at + 1}
            aria-setsize={items.length}
            aria-label={item.diskName}
            title={item.diskName}
            tabIndex={at === stop ? 0 : -1}
            onClick={() => show(at)}
            onContextMenu={(event) =>
              context.open(
                event,
                item.diskName,
                itemMenu(item, () => show(at)),
              )
            }
            className={`focus-ring block size-full ${THUMB_FRAME} transition-opacity duration-(--motion-quick) ease-out motion-reduce:transition-none ${at === index ? "" : "opacity-(--strip-rest) hover:opacity-100"}`}
          >
            <ThumbFace
              src={item.thumb ? convertFileSrc(item.thumb) : undefined}
              current={at === index}
              badge={false}
            />
          </button>
        </div>,
      );
    }
  }

  return (
    <div className="relative h-strip shrink-0 border-line border-t">
      {context.menu}
      <div
        ref={scroller}
        role="listbox"
        aria-label="Filmstrip"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        onWheel={(event) => {
          // A wheel turned up and down runs the strip along, as it has no height to scroll.
          if (scroller.current && Math.abs(event.deltaY) > Math.abs(event.deltaX))
            scroller.current.scrollLeft += event.deltaY;
        }}
        // The ends are padded clear of the steps, so the first and last frames can be reached.
        className="size-full overflow-x-auto overflow-y-hidden px-[calc(var(--spacing-strip-step)+var(--spacing-strip-inset)*2)] py-strip-inset [scrollbar-width:none]"
      >
        <div
          className="relative mx-auto h-full"
          style={{ width: Math.max(0, items.length * step - view.gap) }}
        >
          <span
            ref={cellProbe}
            aria-hidden="true"
            className="invisible absolute h-full aspect-strip"
          />
          <span ref={gapProbe} aria-hidden="true" className="invisible absolute w-tile-gap" />
          {frames}
        </div>
      </div>
      {/* The panel fades in over each end, so the steps stand on something and the strip runs on. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-strip-fade bg-linear-to-r from-15% from-panel to-transparent"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-strip-fade bg-linear-to-l from-15% from-panel to-transparent"
      />
      <StepButton
        side="start"
        label="Previous"
        disabled={index <= 0}
        onClick={() => show(index - 1)}
      />
      <StepButton
        side="end"
        label="Next"
        disabled={index < 0 || index >= items.length - 1}
        onClick={() => show(index + 1)}
      />
    </div>
  );
}

/** The track's scroll and width, and the frame and gap sizes the stylesheet gives, in pixels. */
function useTrackView(
  scroller: RefObject<HTMLElement | null>,
  cellProbe: RefObject<HTMLElement | null>,
  gapProbe: RefObject<HTMLElement | null>,
) {
  const [view, setView] = useState({ left: 0, width: 0, cell: 0, gap: 0, pad: 0 });

  useLayoutEffect(() => {
    const element = scroller.current;
    const cell = cellProbe.current;
    const gap = gapProbe.current;
    if (!element || !cell || !gap) return;
    const measure = () =>
      setView({
        left: element.scrollLeft,
        width: element.clientWidth,
        cell: cell.getBoundingClientRect().width,
        gap: gap.getBoundingClientRect().width,
        pad: Number.parseFloat(getComputedStyle(element).paddingLeft) || 0,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(cell);
    observer.observe(gap);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [scroller, cellProbe, gapProbe]);

  return view;
}

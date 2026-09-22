import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";

import { Glyph } from "../../ui/Glyph";
import { PlateButton } from "../../ui/Plate";
import {
  fitScale,
  NOTCH_IN,
  NOTCH_OUT,
  type Point,
  panBy,
  pannable,
  placement,
  type Size,
  scaleOf,
  type View,
  zoomAbout,
} from "./zoom";

const NONE: Size = { width: 0, height: 0 };

/**
 * Zooming the pane's picture: the wheel, a drag, a double-click and the keys on the media area, and
 * what they do to it. `image` is the picture's own size once the original is in; until then, and for
 * a video or a tile, there is nothing to zoom.
 */
export function useZoom(area: RefObject<HTMLElement | null>, image: Size | null) {
  const on = image !== null;
  const [view, setView] = useState<View>(null);
  const [size, setSize] = useState(NONE);
  const [dragging, setDragging] = useState(false);
  const last = useRef<Point | null>(null);

  useLayoutEffect(() => {
    const box = area.current;
    if (!on || !box) return;
    const measure = () => setSize({ width: box.clientWidth, height: box.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
    return () => observer.disconnect();
  }, [area, on]);

  const own = image ?? NONE;
  const fit = fitScale(size, own);
  const room = on && pannable(view, fit, own, size);
  const zoomBy = (factor: number, at: Point) =>
    setView((held) => zoomAbout(held, factor, at, fit, own));

  const handlers = on
    ? {
        tabIndex: 0,
        role: "group",
        "aria-label": "Zoom",
        "aria-keyshortcuts": "+ - 0",
        onWheel: (event: WheelEvent) => {
          const box = event.currentTarget.getBoundingClientRect();
          const at = {
            x: event.clientX - box.left - box.width / 2,
            y: event.clientY - box.top - box.height / 2,
          };
          zoomBy(event.deltaY < 0 ? NOTCH_IN : NOTCH_OUT, at);
        },
        onPointerDown: (event: PointerEvent) => {
          // The plate sits on the picture; a drag started on it would capture the pointer from its click.
          if (event.button !== 0 || !room || (event.target as Element).closest("button")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          last.current = { x: event.clientX, y: event.clientY };
          setDragging(true);
        },
        onPointerMove: (event: PointerEvent) => {
          const from = last.current;
          if (!from) return;
          last.current = { x: event.clientX, y: event.clientY };
          const delta = { x: event.clientX - from.x, y: event.clientY - from.y };
          setView((held) => panBy(held, delta, fit));
        },
        onPointerUp: () => {
          last.current = null;
          setDragging(false);
        },
        onPointerCancel: () => {
          last.current = null;
          setDragging(false);
        },
        onDoubleClick: () => setView(null),
        onKeyDown: (event: KeyboardEvent) => {
          // Ctrl with the same keys is the interface size, which is the window's, not the picture's.
          if (
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.target !== event.currentTarget
          )
            return;
          const step = { x: size.width / 10, y: size.height / 10 };
          const pan: Record<string, Point> = {
            ArrowLeft: { x: step.x, y: 0 },
            ArrowRight: { x: -step.x, y: 0 },
            ArrowUp: { x: 0, y: step.y },
            ArrowDown: { x: 0, y: -step.y },
          };
          const move = pan[event.key];
          if (event.key === "+" || event.key === "=") zoomBy(NOTCH_IN, { x: 0, y: 0 });
          else if (event.key === "-") zoomBy(NOTCH_OUT, { x: 0, y: 0 });
          else if (event.key === "0") setView(null);
          else if (move && room) setView((held) => panBy(held, move, fit));
          else return;
          event.preventDefault();
        },
      }
    : {};

  const zoomed = on && view !== null;
  const at = placement(view, fit, own, size);
  const style: CSSProperties | undefined = zoomed
    ? { position: "absolute", left: at.left, top: at.top, width: at.width, height: at.height }
    : undefined;
  const cursor = room ? (dragging ? "cursor-grabbing" : "cursor-grab") : "";

  return {
    zoomed,
    handlers,
    style,
    cursor,
    percent: Math.round(scaleOf(view, fit) * 100),
    fit: () => setView(null),
  };
}

/**
 * The one piece of zoom furniture: absent at fit, and off fit the figure, which is also the way back.
 * Under the pointer the figure becomes the word; the keyboard's focus keeps the figure.
 */
export function ZoomPlate({ percent, onFit }: { percent: number; onFit: () => void }) {
  return (
    <PlateButton
      label={`Fit, from ${percent}%`}
      onClick={onFit}
      className="group/plate absolute bottom-tile-inset left-tile-inset"
    >
      <span className="group-hover/plate:hidden">{percent}%</span>
      <span className="hidden items-center gap-1 group-hover/plate:flex">
        <Glyph name="fit" className="text-glyph" />
        Fit
      </span>
    </PlateButton>
  );
}

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

export type Side = "nav" | "pane";
export type FrameLayout = ReturnType<typeof useFrameLayout>;

function token(name: string) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
}

function readMetrics() {
  const limits = (side: Side) => ({
    initial: token(`--frame-${side}`),
    min: token(`--frame-${side}-min`),
    max: token(`--frame-${side}-max`),
  });
  return {
    nav: limits("nav"),
    pane: limits("pane"),
    gridMin: token("--frame-grid-min"),
    rail: token("--spacing-rail"),
    splitter: token("--spacing-splitter"),
  };
}

/** Panel widths in rem, and which panels fold because the frame has no room for them. */
export function useFrameLayout() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [metrics] = useState(readMetrics);
  const [widths, setWidths] = useState({ nav: metrics.nav.initial, pane: metrics.pane.initial });
  const [hidden, setHidden] = useState({ nav: false, pane: false });
  const [overlay, setOverlay] = useState<Side | null>(null);
  const room = useRoomInRem(frameRef);

  // The grid never folds; navigation outranks the pane, so the pane goes first.
  const { gridMin, rail, splitter } = metrics;
  const navFits = !hidden.nav && widths.nav + splitter + gridMin + rail <= room;
  const navSpace = navFits ? widths.nav + splitter : rail;
  const paneFits = !hidden.pane && navSpace + gridMin + splitter + widths.pane <= room;
  const folded = { nav: !navFits, pane: !paneFits };
  const open = overlay && folded[overlay] ? overlay : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverlay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return {
    frameRef,
    metrics,
    widths,
    folded,
    open,
    setWidth: (side: Side, rem: number) => setWidths((current) => ({ ...current, [side]: rem })),
    show: (side: Side) => {
      setHidden((current) => ({ ...current, [side]: false }));
      setOverlay(side);
    },
    hide: (side: Side) => {
      setHidden((current) => ({ ...current, [side]: true }));
      setOverlay(null);
    },
    close: () => setOverlay(null),
  };
}

/** The frame's width in rem, kept current as the window, the zoom or the text size changes. */
function useRoomInRem(ref: RefObject<HTMLElement | null>) {
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    // A 1rem probe resizes when the root font size does, which the frame alone would not report.
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:1rem;height:0";
    document.body.append(probe);
    const measure = () => setRoom(frame.clientWidth / probe.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(probe);
    measure();
    return () => {
      observer.disconnect();
      probe.remove();
    };
  }, [ref]);

  return room;
}

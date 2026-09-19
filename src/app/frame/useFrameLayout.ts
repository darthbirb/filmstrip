import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getPreferences, updatePreferences } from "../preferences";

export type Side = "nav" | "pane";
export type FrameLayout = ReturnType<typeof useFrameLayout>;
type Metrics = ReturnType<typeof readMetrics>;

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
  const [asked, setAsked] = useState(() => restoredWidths(metrics, getPreferences().widths));
  const [hidden, setHidden] = useState(
    () => getPreferences().hidden ?? { nav: false, pane: false },
  );
  const [overlay, setOverlay] = useState<Side | null>(null);
  // What each panel's own content needs, which is a floor under the width asked for.
  const [floors, setFloors] = useState({ nav: 0, pane: 0 });
  const room = useRoomInRem(frameRef);
  const settled = useSettled();

  const widths = { nav: Math.max(asked.nav, floors.nav), pane: Math.max(asked.pane, floors.pane) };

  // The grid never folds; navigation outranks the pane, so the pane goes first.
  const { gridMin, rail, splitter } = metrics;
  const navFits = !hidden.nav && widths.nav + splitter + gridMin + rail <= room;
  const navSpace = navFits ? widths.nav + splitter : rail;
  const paneFits = !hidden.pane && navSpace + gridMin + splitter + widths.pane <= room;
  const folded = { nav: !navFits, pane: !paneFits };
  const open = overlay && folded[overlay] ? overlay : null;
  // Whether a panel would dock if it were not hidden.
  const fitsShown = (side: Side) =>
    side === "nav"
      ? widths.nav + splitter + gridMin + rail <= room
      : navSpace + gridMin + splitter + widths.pane <= room;

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
    /** The width each panel was dragged to, before its own content had its say. */
    asked,
    floors,
    /** What a panel's content needs; 0 where it needs no more than it was given. */
    setFloor: (side: Side, rem: number) =>
      setFloors((held) => (held[side] === rem ? held : { ...held, [side]: rem })),
    folded,
    open,
    settled,
    setWidth: (side: Side, rem: number) => {
      const next = { ...asked, [side]: rem };
      setAsked(next);
      updatePreferences({ widths: next });
    },
    /** Docks the panel where it fits, and opens it over the grid where it does not. */
    show: (side: Side) => {
      if (hidden[side]) {
        const next = { ...hidden, [side]: false };
        setHidden(next);
        updatePreferences({ hidden: next });
      }
      // An overlay left set on a docked panel would spring open the moment the window narrowed.
      setOverlay(fitsShown(side) ? null : side);
    },
    hide: (side: Side) => {
      const next = { ...hidden, [side]: true };
      setHidden(next);
      updatePreferences({ hidden: next });
      setOverlay(null);
    },
    close: () => setOverlay(null),
  };
}

/** Whether the frame has measured itself and drawn once, since nothing animates on first paint. */
function useSettled() {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let live = true;
    // Two frames: the observer's first measurement lands in the first, the fold it decides in the second.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => live && setSettled(true));
    });
    return () => {
      live = false;
      cancelAnimationFrame(id);
    };
  }, []);
  return settled;
}

/** Saved widths, held within today's limits; the defaults where nothing was saved. */
function restoredWidths(metrics: Metrics, saved?: { nav: number; pane: number }) {
  const width = (side: Side) =>
    Math.min(
      metrics[side].max,
      Math.max(metrics[side].min, saved?.[side] ?? metrics[side].initial),
    );
  return { nav: width("nav"), pane: width("pane") };
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

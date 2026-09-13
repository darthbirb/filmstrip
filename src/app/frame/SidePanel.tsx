import { type ReactNode, type RefObject, useEffect, useRef } from "react";

import { GlyphButton } from "../../ui/GlyphButton";
import { Splitter } from "../../ui/Splitter";
import type { FrameLayout, Side } from "./useFrameLayout";

const COPY = {
  nav: {
    label: "Navigation",
    caption: "Library",
    show: "Show navigation",
    hide: "Hide navigation",
    showGlyph: "showLeft",
    hideGlyph: "hideLeft",
    edge: "border-r",
  },
  pane: {
    label: "Pane",
    caption: undefined,
    show: "Show pane",
    hide: "Hide pane",
    showGlyph: "showRight",
    hideGlyph: "hideRight",
    edge: "border-l",
  },
} as const;

type Props = { layout: FrameLayout; side: Side; children?: ReactNode };

/** Navigation or the pane: docked beside a splitter, or folded to a rail that opens it over the grid. */
export function SidePanel({ layout, side, children }: Props) {
  const copy = COPY[side];
  const width = `${layout.widths[side]}rem`;
  const limits = layout.metrics[side];
  const Region = side === "nav" ? "nav" : "aside";
  const overlayRef = useRef<HTMLElement>(null);
  const open = layout.open === side;
  useDismiss(open, side, overlayRef, layout.close);

  const body = (
    <>
      <div className="flex h-toolbar shrink-0 items-center justify-end gap-1 border-line border-b pr-1.5 pl-3">
        {copy.caption && (
          <span className="min-w-0 flex-1 truncate text-eyebrow text-fg-dim uppercase">
            {copy.caption}
          </span>
        )}
        <GlyphButton glyph={copy.hideGlyph} label={copy.hide} onClick={() => layout.hide(side)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </>
  );

  if (layout.folded[side]) {
    const edge = side === "nav" ? "left" : "right";
    return (
      <>
        <div
          data-frame-toggle={side}
          className={`flex w-rail shrink-0 flex-col items-center border-line bg-panel ${copy.edge}`}
        >
          <div className="grid h-toolbar w-full place-items-center border-line border-b">
            <GlyphButton
              glyph={copy.showGlyph}
              label={copy.show}
              pressed={open}
              onClick={() => (open ? layout.close() : layout.show(side))}
            />
          </div>
        </div>
        {open && (
          <Region
            ref={overlayRef}
            aria-label={copy.label}
            className={`absolute inset-y-0 z-(--z-overlay) flex flex-col border-line bg-panel shadow-overlay ${copy.edge}`}
            style={{ width, [edge]: "var(--spacing-rail)" }}
          >
            {body}
          </Region>
        )}
      </>
    );
  }

  const splitter = (
    <Splitter
      label={`Resize ${copy.label.toLowerCase()}`}
      value={layout.widths[side]}
      min={limits.min}
      max={limits.max}
      initial={limits.initial}
      panel={side === "nav" ? "before" : "after"}
      onChange={(rem) => layout.setWidth(side, rem)}
    />
  );
  const panel = (
    <Region
      aria-label={copy.label}
      className={`flex shrink-0 flex-col border-line bg-panel ${copy.edge}`}
      style={{ width }}
    >
      {body}
    </Region>
  );
  return side === "nav" ? (
    <>
      {panel}
      {splitter}
    </>
  ) : (
    <>
      {splitter}
      {panel}
    </>
  );
}

/** Closes an open overlay when the pointer goes down anywhere but on it or on its rail. */
function useDismiss(
  open: boolean,
  side: Side,
  ref: RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (ref.current?.contains(target) || target?.closest(`[data-frame-toggle="${side}"]`)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, side, ref, close]);
}

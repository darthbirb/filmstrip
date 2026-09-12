import { type ReactNode, useEffect, useRef } from "react";

import { GlyphButton } from "../../ui/GlyphButton";
import { Splitter } from "../../ui/Splitter";
import type { FrameLayout, Side } from "./useFrameLayout";

const COPY = {
  nav: { label: "Navigation", show: "Show navigation", hide: "Hide navigation", glyph: "dockLeft" },
  pane: { label: "Pane", show: "Show pane", hide: "Hide pane", glyph: "dockRight" },
} as const;

type Props = {
  layout: FrameLayout;
  side: Side;
  /** A header row of its own, holding the hide button. */
  header?: boolean;
  /** A rail left behind when folded, holding the show button. */
  rail?: boolean;
  /** Floats over the grid instead of taking width from it. */
  floating?: boolean;
  children?: ReactNode;
};

/** Navigation or the pane: docked, folded to a rail, or open over the grid while folded. */
export function SidePanel({
  layout,
  side,
  header = false,
  rail = true,
  floating = false,
  children,
}: Props) {
  const copy = COPY[side];
  const width = `${layout.widths[side]}rem`;
  const limits = layout.metrics[side];
  const Region = side === "nav" ? "nav" : "aside";
  const overlayRef = useRef<HTMLElement>(null);
  const open = layout.open === side;
  useDismiss(open, side, overlayRef, layout.close);

  const body = (
    <>
      {header && (
        <div
          className={`flex h-toolbar shrink-0 items-center ${side === "pane" ? "justify-end" : ""}`}
        >
          <GlyphButton glyph={copy.glyph} label={copy.hide} onClick={() => layout.hide(side)} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </>
  );

  if (layout.folded[side]) {
    const edge = side === "nav" ? "left" : "right";
    return (
      <>
        {rail && (
          <div
            data-frame-toggle={side}
            className={`flex w-rail shrink-0 flex-col bg-panel ${floating ? "absolute top-toolbar right-0 bottom-0 z-10" : ""}`}
          >
            <PanelToggle layout={layout} side={side} />
          </div>
        )}
        {open && (
          <Region
            ref={overlayRef}
            aria-label={copy.label}
            className="absolute inset-y-0 z-20 flex flex-col bg-panel shadow-overlay"
            style={{ width, [edge]: rail ? "var(--spacing-rail)" : 0 }}
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

  if (floating) {
    return (
      <Region
        aria-label={copy.label}
        className="absolute top-toolbar right-2 bottom-2 z-10 flex overflow-hidden rounded-panel bg-panel shadow-overlay"
        style={{ width }}
      >
        {splitter}
        <div className="flex min-w-0 flex-1 flex-col">{body}</div>
      </Region>
    );
  }

  const panel = (
    <Region aria-label={copy.label} className="flex shrink-0 flex-col bg-panel" style={{ width }}>
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

/** Shows a folded or hidden panel, or hides a docked one. */
export function PanelToggle({ layout, side }: { layout: FrameLayout; side: Side }) {
  const copy = COPY[side];
  const folded = layout.folded[side];
  const open = layout.open === side;
  return (
    <span data-frame-toggle={side} className="contents">
      <GlyphButton
        glyph={copy.glyph}
        label={folded ? copy.show : copy.hide}
        pressed={folded ? open : undefined}
        onClick={() => {
          if (!folded) layout.hide(side);
          else if (open) layout.close();
          else layout.show(side);
        }}
      />
    </span>
  );
}

/** Closes an open overlay when the pointer goes down anywhere but on it or on its toggle. */
function useDismiss(
  open: boolean,
  side: Side,
  ref: React.RefObject<HTMLElement | null>,
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

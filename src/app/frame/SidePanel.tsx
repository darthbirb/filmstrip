import { type ReactNode, type RefObject, useEffect, useRef } from "react";

import { GlyphButton } from "../../ui/GlyphButton";
import { RailButton } from "../../ui/RailButton";
import { Splitter } from "../../ui/Splitter";
import type { FrameLayout, Side } from "./useFrameLayout";

// One glyph for both panels, mirrored for the pane; whether it is pressed says which way it acts.
const COPY = {
  nav: {
    label: "Navigation",
    caption: "Library",
    show: "Show navigation",
    hide: "Hide navigation",
    /** The rail's own way back to the tree, which must not answer to the unfold button's name. */
    tree: "Show the tree",
    flip: false,
    edge: "border-r",
  },
  pane: {
    label: "Pane",
    caption: undefined,
    show: "Show pane",
    hide: "Hide pane",
    tree: undefined,
    flip: true,
    edge: "border-l",
  },
} as const;

type Props = {
  layout: FrameLayout;
  side: Side;
  /** What the panel puts in its header row, beside the fold button. */
  header?: ReactNode;
  /** Pinned under the panel, so nothing above it moves when it changes. */
  foot?: ReactNode;
  /** Beside the fold button, which goes when the panel has the window to itself. */
  headerControl?: ReactNode;
  full?: boolean;
  /** The places the rail keeps while the panel is folded, and that foot's narrower shape. */
  rail?: ReactNode;
  railFoot?: ReactNode;
  children?: ReactNode;
};

/** Navigation or the pane: docked beside a splitter, or folded to a rail that opens it over the grid. */
export function SidePanel({
  layout,
  side,
  header,
  foot,
  headerControl,
  full = false,
  rail,
  railFoot,
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
      <div className="flex h-toolbar shrink-0 items-center justify-end gap-1.5 border-line border-b px-1.5">
        {copy.caption && (
          <span className="min-w-0 flex-1 truncate pl-1.5 text-eyebrow text-fg-dim uppercase">
            {copy.caption}
          </span>
        )}
        {header && <div className="min-w-0 flex-1">{header}</div>}
        {headerControl}
        {/* In full screen there is nothing to fold away from, so the button goes rather than moves. */}
        {!full && (
          <GlyphButton
            glyph="panel"
            flip={copy.flip}
            label={copy.hide}
            onClick={() => layout.hide(side)}
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {foot}
    </>
  );

  // The panel takes the frame whole, keeping every part it has; only the columns beside it go.
  if (full) {
    return (
      <Region
        aria-label={copy.label}
        className="absolute inset-0 z-(--z-overlay) flex flex-col bg-panel"
      >
        {body}
      </Region>
    );
  }

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
              glyph="panel"
              flip={copy.flip}
              label={copy.show}
              pressed={open}
              onClick={() => (open ? layout.close() : layout.show(side))}
            />
          </div>
          {rail && (
            <div className="flex min-h-0 flex-1 flex-col items-center gap-2 p-1.5">
              {rail}
              <span aria-hidden="true" className="my-1.5 h-px w-full shrink-0 bg-line" />
              {/* Without it the tree is simply gone until you unfold, which makes folding a trap. */}
              <RailButton
                glyph="tree"
                label={copy.tree ?? copy.show}
                pressed={open}
                onClick={() => (open ? layout.close() : layout.show(side))}
              />
            </div>
          )}
          {railFoot}
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

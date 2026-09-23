import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { GlyphButton } from "../../ui/GlyphButton";
import { RailButton } from "../../ui/RailButton";
import { Splitter } from "../../ui/Splitter";
import type { FrameLayout, Side } from "./useFrameLayout";

// One glyph for both panels, mirrored for the pane; whether it is pressed says which way it acts.
const COPY = {
  nav: {
    label: "Navigation",
    caption: "Library",
    show: "Show Navigation",
    hide: "Hide Navigation",
    /** The rail's own way back to the tree, which must not answer to the unfold button's name. */
    tree: "Show Folders",
    flip: false,
    edge: "border-r",
  },
  pane: {
    label: "Pane",
    caption: undefined,
    show: "Show Pane",
    hide: "Hide Pane",
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
  /** Another surface has the window: fade out of the way and stop answering. */
  behind?: boolean;
  /** The places the rail keeps while the panel is folded, and that foot's narrower shape. */
  rail?: ReactNode;
  railFoot?: ReactNode;
  children?: ReactNode;
};

/** Navigation or the pane: one box whose width says whether it is docked, folded or whole. DECISIONS.md "The frame". */
export function SidePanel({
  layout,
  side,
  header,
  foot,
  headerControl,
  full = false,
  behind = false,
  rail,
  railFoot,
  children,
}: Props) {
  const copy = COPY[side];
  const own = `${layout.widths[side]}rem`;
  const limits = layout.metrics[side];
  const Region = side === "nav" ? "nav" : "aside";
  const regionRef = useRef<HTMLElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const [sizing, setSizing] = useState(false);
  const folded = layout.folded[side];
  const open = layout.open === side;
  const showRail = folded && !open && !full;
  useDismiss(open, regionRef, layout.close);

  // The box's width is the state: a rail folded, its own docked or laid over the grid, the frame whole.
  const width = full ? "100%" : showRail ? "var(--spacing-rail)" : own;
  // What it keeps in the row, which a panel over the grid or filling the window no longer matches.
  const held = folded ? "var(--spacing-rail)" : own;
  const grows = layout.settled && !sizing;

  useFloor(layout, side, faceRef, !folded && !full);

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

  const unfold = () => (open ? layout.close() : layout.show(side));
  const railColumn = (
    <>
      <div className="grid h-toolbar w-full place-items-center border-line border-b">
        <GlyphButton
          glyph="panel"
          flip={copy.flip}
          label={copy.show}
          pressed={open}
          onClick={unfold}
        />
      </div>
      {rail && (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 p-1.5">
          {rail}
          <span aria-hidden="true" className="my-1.5 h-px w-full shrink-0 bg-line" />
          {/* Without it the tree is simply gone until you unfold, which makes folding a trap. */}
          <RailButton glyph="tree" label={copy.tree ?? copy.show} pressed={open} onClick={unfold} />
        </div>
      )}
      {railFoot}
    </>
  );

  const splitter = (
    <Splitter
      label={`Resize ${copy.label}`}
      value={layout.widths[side]}
      min={Math.max(limits.min, layout.floors[side])}
      max={limits.max}
      initial={limits.initial}
      panel={side === "nav" ? "before" : "after"}
      onChange={(rem) => layout.setWidth(side, rem)}
      onSizing={setSizing}
    />
  );
  // The row keeps the panel's place while the box itself is positioned against the frame.
  const place = <div aria-hidden="true" className="shrink-0" style={{ width: held }} />;

  return (
    <div
      inert={behind}
      className={`flex shrink-0 ${behind ? "opacity-0" : "opacity-100"} ${
        layout.settled
          ? "transition-opacity duration-(--motion-swap) ease-out motion-reduce:transition-none"
          : ""
      }`}
    >
      <Region
        ref={regionRef}
        aria-label={copy.label}
        style={side === "nav" ? { width, left: 0 } : { width, right: 0 }}
        // The grid's tiles are positioned too, so without this they paint over a folding panel.
        className={`absolute inset-y-0 z-(--z-overlay) overflow-hidden border-line bg-panel ${copy.edge} ${
          open ? "shadow-overlay" : ""
        } ${
          grows
            ? "transition-[width] duration-(--motion-size) ease-out motion-reduce:transition-none"
            : ""
        }`}
      >
        <Layer
          ref={faceRef}
          shown={!showRail}
          width={full ? "100%" : own}
          side={side}
          settled={layout.settled}
        >
          {body}
        </Layer>
        <Layer
          shown={showRail}
          width="var(--spacing-rail)"
          side={side}
          settled={layout.settled}
          center
        >
          {railColumn}
        </Layer>
      </Region>
      {side === "nav" ? (
        <>
          {place}
          {splitter}
        </>
      ) : (
        <>
          {splitter}
          {place}
        </>
      )}
    </div>
  );
}

type LayerProps = {
  ref?: RefObject<HTMLDivElement | null>;
  shown: boolean;
  width: string;
  side: Side;
  settled: boolean;
  center?: boolean;
  children: ReactNode;
};

/** One of the panel's two faces, held at its own width so the box clips it rather than reflowing it. */
function Layer({ ref, shown, width, side, settled, center, children }: LayerProps) {
  return (
    <div
      ref={ref}
      inert={!shown}
      style={side === "nav" ? { width, left: 0 } : { width, right: 0 }}
      className={`absolute inset-y-0 flex flex-col ${center ? "items-center" : ""} ${
        shown ? "visible opacity-100" : "invisible opacity-0"
      } ${
        settled
          ? "transition-[opacity,visibility] duration-(--motion-swap) ease-out motion-reduce:transition-none"
          : ""
      }`}
    >
      {children}
    </div>
  );
}

/**
 * A button's label is the one thing in a panel that may not be cut, so how much of one is cut
 * right now is how much narrower than its content the panel has been made — and its floor is the
 * width where nothing is. The floor only ever rises while the panel holds the same thing; a floor
 * that fell as soon as it was met would fight the pointer. DECISIONS.md "The frame".
 */
function useFloor(
  layout: FrameLayout,
  side: Side,
  faceRef: RefObject<HTMLDivElement | null>,
  docked: boolean,
) {
  const setFloor = layout.setFloor;
  useEffect(() => {
    const face = faceRef.current;
    if (!docked || !face) {
      setFloor(side, 0);
      return;
    }
    // A 1rem probe resizes when the root font size does, which no element here would report.
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:1rem;height:0";
    document.body.append(probe);
    let held = 0;
    let queued = 0;
    const measure = () => {
      queued = 0;
      const rem = probe.getBoundingClientRect().width;
      const panel = face.getBoundingClientRect().width;
      let needed = 0;
      for (const label of face.querySelectorAll("button .truncate")) {
        // Only a label with something cut off it has anything to say about the width.
        const cut = label.scrollWidth - label.clientWidth;
        if (cut > 0) needed = Math.max(needed, panel + cut);
      }
      if (rem > 0 && needed > held) {
        held = needed;
        setFloor(side, held / rem);
      }
    };
    // Measuring twice in a frame costs two layouts and answers the same, so one is enough.
    const later = () => {
      if (!queued) queued = requestAnimationFrame(measure);
    };
    // Different content needs a different width, so the floor starts again with it.
    const content = new MutationObserver(() => {
      held = 0;
      setFloor(side, 0);
      later();
    });
    content.observe(face, { childList: true, subtree: true, characterData: true });
    const size = new ResizeObserver(later);
    size.observe(probe);
    size.observe(face);
    measure();
    return () => {
      cancelAnimationFrame(queued);
      content.disconnect();
      size.disconnect();
      probe.remove();
    };
  }, [side, docked, faceRef, setFloor]);
}

/** Closes an open panel when the pointer goes down anywhere but on it. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Element | null)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, ref, close]);
}

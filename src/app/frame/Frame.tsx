import { type ReactNode, useEffect, useEffectEvent } from "react";

import { GlyphButton } from "../../ui/GlyphButton";
import { SidePanel } from "./SidePanel";
import { useFrameLayout } from "./useFrameLayout";

/** What fills the frame. Each region belongs to a later slice. */
export type Regions = {
  nav?: ReactNode;
  /** Navigation's foot, its folded rail, and that foot's narrower shape. */
  navFoot?: ReactNode;
  navRail?: ReactNode;
  navRailFoot?: ReactNode;
  location?: ReactNode;
  /** Above the grid, where something needing a decision waits until it is dealt with. */
  notices?: ReactNode;
  grid?: ReactNode;
  pane?: ReactNode;
  /** Beside the pane's fold button, in its header row. */
  paneHeader?: ReactNode;
  /** Subscribes to the pane being given something to show, which opens it if folded or hidden. */
  revealPane?: (listener: () => void) => () => void;
  /** Whether the pane has the window to itself, and what the control in its header does. */
  full?: boolean;
  onToggleFull?: () => void;
};

/** Navigation, the grid and the pane as docked columns, each with its own header row. DECISIONS.md "The frame". */
export function Frame({
  nav,
  navFoot,
  navRail,
  navRailFoot,
  location,
  notices,
  grid,
  pane,
  paneHeader,
  revealPane,
  full = false,
  onToggleFull,
}: Regions) {
  const layout = useFrameLayout();
  const reveal = useEffectEvent(() => layout.show("pane"));
  useEffect(() => revealPane?.(reveal), [revealPane]);

  return (
    <div ref={layout.frameRef} className="relative flex min-h-0 flex-1 border-line border-t">
      {/* Hidden rather than dropped, so nothing either column holds is rebuilt on the way back. */}
      <div className={full ? "hidden" : "contents"}>
        <SidePanel layout={layout} side="nav" foot={navFoot} rail={navRail} railFoot={navRailFoot}>
          {nav}
        </SidePanel>
      </div>
      <main className={`flex min-w-0 flex-1 flex-col ${full ? "hidden" : ""}`}>
        <div className="flex h-toolbar shrink-0 items-center gap-3 border-line border-b bg-panel pr-2 pl-3">
          {location}
        </div>
        {notices}
        <div className="min-h-0 flex-1 overflow-auto">{grid}</div>
      </main>
      <SidePanel
        layout={layout}
        side="pane"
        header={paneHeader}
        full={full}
        headerControl={
          onToggleFull && (
            <GlyphButton
              glyph={full ? "collapse" : "expand"}
              label={full ? "Leave full screen" : "Full screen"}
              pressed={full}
              onClick={onToggleFull}
            />
          )
        }
      >
        {pane}
      </SidePanel>
    </div>
  );
}

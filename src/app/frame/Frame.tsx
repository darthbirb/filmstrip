import { type ReactNode, useEffect, useEffectEvent } from "react";

import { SidePanel } from "./SidePanel";
import { useFrameLayout } from "./useFrameLayout";

/** What fills the frame. Each region belongs to a later slice. */
export type Regions = {
  nav?: ReactNode;
  /** Beside navigation's caption, in its header row. */
  navControl?: ReactNode;
  /** Navigation's foot, its folded rail, and that foot's narrower shape. */
  navFoot?: ReactNode;
  navRail?: ReactNode;
  navRailFoot?: ReactNode;
  location?: ReactNode;
  /** Above the grid, where something needing a decision waits until it is dealt with. */
  notices?: ReactNode;
  grid?: ReactNode;
  /** Under the grid, in its own column: what acts on the files checked in it. */
  gridFoot?: ReactNode;
  pane?: ReactNode;
  /** Beside the pane's fold button, in its header row. */
  paneHeader?: ReactNode;
  /** Subscribes to the pane being given something to show, which opens it if folded or hidden. */
  revealPane?: (listener: () => void) => () => void;
  /** Whether the pane has the window to itself. */
  full?: boolean;
};

/** Navigation, the grid and the pane as docked columns, each with its own header row. DECISIONS.md "The frame". */
export function Frame({
  nav,
  navControl,
  navFoot,
  navRail,
  navRailFoot,
  location,
  notices,
  grid,
  gridFoot,
  pane,
  paneHeader,
  revealPane,
  full = false,
}: Regions) {
  const layout = useFrameLayout();
  const reveal = useEffectEvent(() => layout.show("pane"));
  useEffect(() => revealPane?.(reveal), [revealPane]);

  return (
    <div ref={layout.frameRef} className="relative flex min-h-0 flex-1 border-line border-t">
      {/* Faded rather than dropped, so nothing either column holds is rebuilt on the way back. */}
      <SidePanel
        layout={layout}
        side="nav"
        headerControl={navControl}
        foot={navFoot}
        rail={navRail}
        railFoot={navRailFoot}
        behind={full}
      >
        {nav}
      </SidePanel>
      <main
        inert={full}
        className={`flex min-w-0 flex-1 flex-col ${full ? "opacity-0" : "opacity-100"} ${
          layout.settled
            ? "transition-opacity duration-(--motion-swap) ease-out motion-reduce:transition-none"
            : ""
        }`}
      >
        <div className="flex h-toolbar shrink-0 items-center gap-3 border-line border-b bg-panel pr-2 pl-3">
          {location}
        </div>
        {notices}
        <div className="min-h-0 flex-1 overflow-auto">{grid}</div>
        {gridFoot}
      </main>
      <SidePanel layout={layout} side="pane" header={paneHeader} full={full}>
        {pane}
      </SidePanel>
    </div>
  );
}

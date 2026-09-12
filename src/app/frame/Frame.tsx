import type { ReactNode } from "react";

import { SidePanel } from "./SidePanel";
import { useFrameLayout } from "./useFrameLayout";

/** What fills the frame. Each region belongs to a later slice. */
export type Regions = {
  nav?: ReactNode;
  location?: ReactNode;
  grid?: ReactNode;
  pane?: ReactNode;
};

/** Navigation, the grid and the pane as docked columns, each with its own header row. DECISIONS.md "The frame". */
export function Frame({ nav, location, grid, pane }: Regions) {
  const layout = useFrameLayout();
  return (
    <div ref={layout.frameRef} className="relative flex min-h-0 flex-1 border-line border-t">
      <SidePanel layout={layout} side="nav">
        {nav}
      </SidePanel>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-toolbar shrink-0 items-center gap-2 px-2">{location}</div>
        <div className="min-h-0 flex-1 overflow-auto">{grid}</div>
      </main>
      <SidePanel layout={layout} side="pane">
        {pane}
      </SidePanel>
    </div>
  );
}

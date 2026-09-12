import type { Regions } from ".";
import { PanelToggle, SidePanel } from "./SidePanel";
import { useFrameLayout } from "./useFrameLayout";

/** One toolbar across the window, with the panel toggles at its ends; the panels below have no headers. */
export function Toolbar({ nav, toolbar, grid, pane }: Regions) {
  const layout = useFrameLayout();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-toolbar shrink-0 items-center gap-2 border-line border-y">
        <PanelToggle layout={layout} side="nav" />
        <div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div>
        <PanelToggle layout={layout} side="pane" />
      </div>
      <div ref={layout.frameRef} className="relative flex min-h-0 flex-1">
        <SidePanel layout={layout} side="nav" rail={false}>
          {nav}
        </SidePanel>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{grid}</main>
        <SidePanel layout={layout} side="pane" rail={false}>
          {pane}
        </SidePanel>
      </div>
    </div>
  );
}

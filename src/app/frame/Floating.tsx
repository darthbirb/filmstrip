import type { Regions } from ".";
import { SidePanel } from "./SidePanel";
import { useFrameLayout } from "./useFrameLayout";

/** Navigation docked; the pane floats over the grid's right edge, so the grid never reflows. */
export function Floating({ nav, toolbar, grid, pane }: Regions) {
  const layout = useFrameLayout();
  return (
    <div ref={layout.frameRef} className="relative flex min-h-0 flex-1 border-line border-t">
      <SidePanel layout={layout} side="nav" header>
        {nav}
      </SidePanel>
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-toolbar shrink-0 items-center gap-2 px-2">{toolbar}</div>
        <div className="min-h-0 flex-1 overflow-auto">{grid}</div>
        <SidePanel layout={layout} side="pane" header floating>
          {pane}
        </SidePanel>
      </main>
    </div>
  );
}

import type { Regions } from ".";
import { SidePanel } from "./SidePanel";
import { useFrameLayout } from "./useFrameLayout";

/** Three docked columns, each with its own header row; the grid's holds location and search. */
export function Columns({ nav, toolbar, grid, pane }: Regions) {
  const layout = useFrameLayout();
  return (
    <div ref={layout.frameRef} className="relative flex min-h-0 flex-1 border-line border-t">
      <SidePanel layout={layout} side="nav" header>
        {nav}
      </SidePanel>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-toolbar shrink-0 items-center gap-2 px-2">{toolbar}</div>
        <div className="min-h-0 flex-1 overflow-auto">{grid}</div>
      </main>
      <SidePanel layout={layout} side="pane" header>
        {pane}
      </SidePanel>
    </div>
  );
}

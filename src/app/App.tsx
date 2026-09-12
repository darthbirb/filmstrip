import { useEffect, useState } from "react";

import { PaneStandIn, SearchStandIn } from "../dev/FrameStandIns";
import { StandIn } from "../dev/StandIn";
import { Frame } from "./frame/Frame";
import { Breadcrumb } from "./navigation/Breadcrumb";
import { Navigation } from "./navigation/Navigation";
import { useScaleHotkeys } from "./preferences";
import { WindowBar } from "./window-bar/WindowBar";

// Until the slices that fill them land, these regions hold dev stand-ins, and nothing in production.
const GRID = import.meta.env.DEV ? <StandIn /> : undefined;
const PANE = import.meta.env.DEV ? <PaneStandIn /> : undefined;
const SEARCH = import.meta.env.DEV ? <SearchStandIn /> : undefined;

export function App() {
  useScaleHotkeys();

  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <WindowBar search={SEARCH} />
      <Frame nav={<Navigation />} location={<Breadcrumb />} grid={GRID} pane={PANE} />
      {import.meta.env.DEV && (
        <footer className="flex items-center gap-4 px-3 py-1 text-xs">
          <DisplayReadout />
        </footer>
      )}
    </div>
  );
}

// What the display settings actually reach: zoom, Windows text size, display scaling.
function DisplayReadout() {
  const [reading, setReading] = useState(read);

  useEffect(() => {
    const update = () => setReading(read());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <output data-testid="display-readout" className="tabular-nums opacity-60">
      {reading}
    </output>
  );
}

function read() {
  const rootFont = getComputedStyle(document.documentElement).fontSize;
  return `dpr ${window.devicePixelRatio} · root ${rootFont} · viewport ${window.innerWidth}×${window.innerHeight}`;
}

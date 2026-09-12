import { useEffect, useState } from "react";

import { LocationStandIn, NavStandIn, PaneStandIn, SearchStandIn } from "../dev/FrameStandIns";
import { StandIn } from "../dev/StandIn";
import { Frame, type Regions } from "./frame/Frame";
import { useScaleHotkeys } from "./preferences";
import { WindowBar } from "./window-bar/WindowBar";

// Until the slices that fill them land, the regions hold dev stand-ins, and nothing in production.
const REGIONS: Regions = import.meta.env.DEV
  ? { nav: <NavStandIn />, location: <LocationStandIn />, grid: <StandIn />, pane: <PaneStandIn /> }
  : {};
const SEARCH = import.meta.env.DEV ? <SearchStandIn /> : undefined;

export function App() {
  useScaleHotkeys();

  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <WindowBar search={SEARCH} />
      <Frame {...REGIONS} />
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

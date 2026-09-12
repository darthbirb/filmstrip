import { useEffect, useState } from "react";

import { CandidatePicker } from "../dev/CandidatePicker";
import { CompareCandidates } from "../dev/CompareCandidates";
import { PaneStandIn, SearchStandIn } from "../dev/FrameStandIns";
import { COMPARE, useCandidate } from "./candidates";
import { Frame } from "./frame/Frame";
import { Grid } from "./grid/Grid";
import { TileSize } from "./grid/TileSize";
import { Breadcrumb } from "./navigation/Breadcrumb";
import { Navigation } from "./navigation/Navigation";
import { useScaleHotkeys } from "./preferences";
import { WindowBar } from "./window-bar/WindowBar";

// The grid slice's candidates, until the user picks one. DEVELOPMENT.md "Slices".
const GRIDS = {
  justified: () => <Grid mode="justified" />,
  uniform: () => <Grid mode="uniform" />,
};
const GRID_NAMES = ["justified", "uniform"] as const;
const PICKER_NAMES = [...GRID_NAMES, COMPARE] as const;

// Until the slices that fill them land, these regions hold dev stand-ins, and nothing in production.
const PANE = import.meta.env.DEV ? <PaneStandIn /> : undefined;
const SEARCH = import.meta.env.DEV ? <SearchStandIn /> : undefined;

export function App() {
  useScaleHotkeys();
  const [grid, chooseGrid] = useCandidate("grid", GRID_NAMES);
  const comparing = import.meta.env.DEV && grid === COMPARE;

  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <WindowBar search={SEARCH} />
      {comparing ? (
        <CompareCandidates candidates={GRIDS} />
      ) : (
        <Frame
          nav={<Navigation />}
          location={
            <>
              <Breadcrumb />
              <TileSize />
            </>
          }
          grid={<Grid mode={grid === COMPARE ? "justified" : grid} />}
          pane={PANE}
        />
      )}
      {import.meta.env.DEV && (
        <footer className="flex items-center gap-4 px-3 py-1 text-xs">
          <DisplayReadout />
          <CandidatePicker slice="grid" names={PICKER_NAMES} current={grid} onChoose={chooseGrid} />
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

import { useEffect, useState } from "react";

import { CandidatePicker } from "../dev/CandidatePicker";
import { CompareCandidates } from "../dev/CompareCandidates";
import { SearchStandIn } from "../dev/FrameStandIns";
import { COMPARE, useCandidate } from "./candidates";
import { Frame } from "./frame/Frame";
import { Grid } from "./grid/Grid";
import { LayoutToggle } from "./grid/LayoutToggle";
import { DEFAULT_LAYOUT } from "./grid/layout";
import { TileSize } from "./grid/TileSize";
import { Breadcrumb } from "./navigation/Breadcrumb";
import { Navigation } from "./navigation/Navigation";
import { PANE_CANDIDATES, Pane } from "./pane/Pane";
import { usePreferences, useScaleHotkeys } from "./preferences";
import { WindowBar } from "./window-bar/WindowBar";

// Until the search slice lands, the bar holds a dev stand-in, and nothing in production.
const SEARCH = import.meta.env.DEV ? <SearchStandIn /> : undefined;

const PANE_CHOICES = [...PANE_CANDIDATES, COMPARE] as const;
const COMPARED_PANES = {
  stack: () => <Pane candidate="stack" />,
  viewer: () => <Pane candidate="viewer" />,
  split: () => <Pane candidate="split" />,
};

export function App() {
  useScaleHotkeys();
  const layout = usePreferences().layout ?? DEFAULT_LAYOUT;
  const [pane, choosePane] = useCandidate("pane", PANE_CANDIDATES);

  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <WindowBar search={SEARCH} />
      <Frame
        nav={<Navigation />}
        location={
          <>
            <Breadcrumb />
            <LayoutToggle />
            <TileSize />
          </>
        }
        grid={<Grid mode={layout} />}
        pane={
          import.meta.env.DEV && pane === COMPARE ? (
            <CompareCandidates candidates={COMPARED_PANES} layout="rows" />
          ) : (
            <Pane candidate={pane === COMPARE ? PANE_CANDIDATES[0] : pane} />
          )
        }
      />
      {import.meta.env.DEV && (
        <footer className="flex items-center gap-4 px-3 py-1 text-xs">
          <CandidatePicker slice="pane" names={PANE_CHOICES} current={pane} onChoose={choosePane} />
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

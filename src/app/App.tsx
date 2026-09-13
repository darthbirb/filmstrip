import { useEffect, useState } from "react";

import { CandidatePicker } from "../dev/CandidatePicker";
import { SearchStandIn } from "../dev/FrameStandIns";
import { Specimen } from "../dev/Specimen";
import { Frame } from "./frame/Frame";
import { Grid } from "./grid/Grid";
import { LayoutToggle } from "./grid/LayoutToggle";
import { DEFAULT_LAYOUT } from "./grid/layout";
import { TileSize } from "./grid/TileSize";
import { LOOKS, useLook } from "./look";
import { Breadcrumb } from "./navigation/Breadcrumb";
import { Navigation } from "./navigation/Navigation";
import { Pane } from "./pane/Pane";
import { usePreferences, useScaleHotkeys } from "./preferences";
import { WindowBar } from "./window-bar/WindowBar";

// Until the search slice lands, the bar holds a dev stand-in, and nothing in production.
const SEARCH = import.meta.env.DEV ? <SearchStandIn /> : undefined;

export function App() {
  useScaleHotkeys();
  const layout = usePreferences().layout ?? DEFAULT_LAYOUT;
  const [look, chooseLook] = useLook();
  const [specimen, showSpecimen] = useDevFlag("filmstrip:specimen");

  // What measures a token once is keyed by the look, so a new look is measured afresh.
  const body =
    import.meta.env.DEV && specimen ? (
      <Specimen key={look} />
    ) : (
      <Frame
        nav={<Navigation />}
        location={
          <>
            <Breadcrumb />
            <LayoutToggle />
            <TileSize />
          </>
        }
        grid={<Grid key={look} mode={layout} />}
        pane={<Pane />}
      />
    );

  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <WindowBar search={SEARCH} />
      {body}
      {import.meta.env.DEV && (
        <footer className="flex items-center gap-4 px-3 py-1 text-label">
          <CandidatePicker slice="look" names={LOOKS} current={look} onChoose={chooseLook} />
          <button
            type="button"
            aria-pressed={specimen}
            onClick={() => showSpecimen(!specimen)}
            className={`focus-ring px-2 ${specimen ? "bg-hover text-fg" : "opacity-60"}`}
          >
            specimen
          </button>
          <DisplayReadout />
        </footer>
      )}
    </div>
  );
}

/** A dev switch that survives a reload. */
function useDevFlag(key: string) {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // The switch holds until the next reload.
    }
    setOn(next);
  };
  return [on, set] as const;
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

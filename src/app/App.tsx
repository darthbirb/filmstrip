import { type ComponentType, useEffect, useState } from "react";

import { CandidatePicker } from "../dev/CandidatePicker";
import { CompareCandidates } from "../dev/CompareCandidates";
import { NavStandIn, PaneStandIn, ToolbarStandIn } from "../dev/FrameStandIns";
import { StandIn } from "../dev/StandIn";
import { COMPARE, useCandidate } from "./candidates";
import { FRAMES, type FrameName, type Regions } from "./frame";
import { WindowBar } from "./window-bar/WindowBar";

const FRAME_NAMES = Object.keys(FRAMES) as FrameName[];
const PICKER_NAMES = [...FRAME_NAMES, COMPARE] as const;

// Until the slices that fill them land, the regions hold dev stand-ins, and nothing in production.
const REGIONS: Regions = import.meta.env.DEV
  ? { nav: <NavStandIn />, toolbar: <ToolbarStandIn />, grid: <StandIn />, pane: <PaneStandIn /> }
  : {};

const VIEWS: Record<string, ComponentType> = Object.fromEntries(
  FRAME_NAMES.map((name) => {
    const Frame = FRAMES[name];
    return [name, () => <Frame {...REGIONS} />];
  }),
);

export function App() {
  const [frame, chooseFrame] = useCandidate("frame", FRAME_NAMES);
  const comparing = import.meta.env.DEV && frame === COMPARE;
  const Frame = FRAMES[frame === COMPARE ? "columns" : frame];

  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <WindowBar />
      {comparing ? <CompareCandidates candidates={VIEWS} layout="rows" /> : <Frame {...REGIONS} />}
      {import.meta.env.DEV && (
        <footer className="flex items-center gap-4 px-3 py-1 text-xs">
          <DisplayReadout />
          <CandidatePicker
            slice="frame"
            names={PICKER_NAMES}
            current={frame}
            onChoose={chooseFrame}
          />
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

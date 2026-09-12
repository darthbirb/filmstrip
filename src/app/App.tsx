import { useEffect, useState } from "react";

import { CandidatePicker } from "../dev/CandidatePicker";
import { CompareCandidates } from "../dev/CompareCandidates";
import { StandIn } from "../dev/StandIn";
import { COMPARE, useCandidate } from "./candidates";
import { WINDOW_BARS, type WindowBarName } from "./window-bar";

const BAR_NAMES = Object.keys(WINDOW_BARS) as WindowBarName[];
const PICKER_NAMES = [...BAR_NAMES, COMPARE] as const;

export function App() {
  const [bar, chooseBar] = useCandidate("window-bar", BAR_NAMES);
  const comparing = import.meta.env.DEV && bar === COMPARE;
  const Bar = WINDOW_BARS[bar === COMPARE ? "strip" : bar];

  return (
    <div className="relative flex h-dvh flex-col bg-ground text-fg">
      {comparing ? (
        <CompareCandidates candidates={WINDOW_BARS} />
      ) : (
        <>
          <Bar />
          <main className="flex min-h-0 flex-1 flex-col">{import.meta.env.DEV && <StandIn />}</main>
        </>
      )}
      {import.meta.env.DEV && (
        <footer className="flex items-center gap-4 px-3 py-1 text-xs">
          <DisplayReadout />
          <CandidatePicker
            slice="window-bar"
            names={PICKER_NAMES}
            current={bar}
            onChoose={chooseBar}
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

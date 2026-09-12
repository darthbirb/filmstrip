import { useEffect, useState } from "react";

import { CandidatePicker } from "../dev/CandidatePicker";
import { chosenCandidate } from "./candidates";
import { WINDOW_BARS, type WindowBarName } from "./window-bar";

const BAR_NAMES = Object.keys(WINDOW_BARS) as WindowBarName[];
const barName = chosenCandidate("window-bar", BAR_NAMES);

export function App() {
  const Bar = WINDOW_BARS[barName];

  return (
    <div className="relative flex h-dvh flex-col bg-ground text-fg">
      <Bar />
      <main className="flex-1" />
      {import.meta.env.DEV && (
        <footer className="flex items-center gap-3 px-3 py-1 text-xs opacity-60">
          <DisplayReadout />
          <CandidatePicker slice="window-bar" names={BAR_NAMES} current={barName} />
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
    <output data-testid="display-readout" className="tabular-nums">
      {reading}
    </output>
  );
}

function read() {
  const rootFont = getComputedStyle(document.documentElement).fontSize;
  return `dpr ${window.devicePixelRatio} · root ${rootFont} · viewport ${window.innerWidth}×${window.innerHeight}`;
}

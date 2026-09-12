import { useEffect, useState } from "react";

import { WindowBar } from "./window-bar/WindowBar";

export function App() {
  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <WindowBar />
      <main className="flex-1" />
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

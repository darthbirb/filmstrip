import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

// Scaffold: with native chrome off, this bar is the only way to move or close the window.
// The window-bar slice replaces it. DEVELOPMENT.md "Slices".
export function App() {
  const win = getCurrentWindow();

  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <header data-tauri-drag-region className="flex h-bar shrink-0 select-none items-center">
        <span data-tauri-drag-region className="flex-1 px-3 text-sm">
          Filmstrip
        </span>
        <button
          type="button"
          aria-label="Minimise"
          className="h-full px-4"
          onClick={() => void win.minimize()}
        >
          –
        </button>
        <button
          type="button"
          aria-label="Maximise"
          className="h-full px-4"
          onClick={() => void win.toggleMaximize()}
        >
          □
        </button>
        <button
          type="button"
          aria-label="Close"
          className="h-full px-4"
          onClick={() => void win.close()}
        >
          ×
        </button>
      </header>
      <main className="flex-1" />
      {import.meta.env.DEV && <DisplayReadout />}
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
    <output data-testid="display-readout" className="px-3 py-1 text-xs tabular-nums opacity-60">
      {reading}
    </output>
  );
}

function read() {
  const rootFont = getComputedStyle(document.documentElement).fontSize;
  return `dpr ${window.devicePixelRatio} · root ${rootFont} · viewport ${window.innerWidth}×${window.innerHeight}`;
}

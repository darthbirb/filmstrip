import { useEffect, useState } from "react";

import { SearchStandIn } from "../dev/FrameStandIns";
import { Frame } from "./frame/Frame";
import { Grid } from "./grid/Grid";
import { DEFAULT_LAYOUT } from "./grid/layout";
import { TileSize } from "./grid/TileSize";
import { Breadcrumb } from "./navigation/Breadcrumb";
import { Navigation } from "./navigation/Navigation";
import { Pane, PaneHeader } from "./pane/Pane";
import { PaneDetailProvider } from "./pane/pane-detail";
import { usePreferences, useScaleHotkeys } from "./preferences";
import { Settings } from "./settings/Settings";
import { WindowBar } from "./window-bar/WindowBar";

// Until the search slice lands, the bar holds a dev stand-in, and nothing in production.
const SEARCH = import.meta.env.DEV ? <SearchStandIn /> : undefined;

export function App() {
  useScaleHotkeys();
  const layout = usePreferences().layout ?? DEFAULT_LAYOUT;
  const [settings, setSettings] = useState(false);

  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <WindowBar search={SEARCH} onSettings={() => setSettings(true)} settingsOpen={settings} />
      <PaneDetailProvider>
        <Frame
          nav={<Navigation />}
          location={
            <>
              <Breadcrumb />
              <TileSize />
            </>
          }
          grid={<Grid mode={layout} />}
          pane={<Pane />}
          paneHeader={<PaneHeader />}
        />
      </PaneDetailProvider>
      <Settings open={settings} onClose={() => setSettings(false)} />
      {import.meta.env.DEV && (
        <footer className="flex items-center gap-4 border-line border-t px-3 py-1 text-fg-dim text-small">
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
    <output data-testid="display-readout" className="tabular-nums">
      {reading}
    </output>
  );
}

function read() {
  const rootFont = getComputedStyle(document.documentElement).fontSize;
  return `dpr ${window.devicePixelRatio} · root ${rootFont} · viewport ${window.innerWidth}×${window.innerHeight}`;
}

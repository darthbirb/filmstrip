import { type ComponentType, useEffect, useState } from "react";

import { CandidatePicker } from "../dev/CandidatePicker";
import { CompareCandidates } from "../dev/CompareCandidates";
import { PaneStandIn, SearchStandIn } from "../dev/FrameStandIns";
import { MarkLadder } from "../dev/MarkLadder";
import { StandIn } from "../dev/StandIn";
import { COMPARE, useCandidate } from "./candidates";
import { Frame } from "./frame/Frame";
import { Mark } from "./mark/Mark";
import { MARKS, type MarkName } from "./mark/marks";
import { Breadcrumb } from "./navigation/Breadcrumb";
import { Navigation } from "./navigation/Navigation";
import { useScaleHotkeys } from "./preferences";
import { WindowBar } from "./window-bar/WindowBar";

const MARK_NAMES = Object.keys(MARKS) as MarkName[];
const PICKER_NAMES = [...MARK_NAMES, COMPARE] as const;
const LADDERS: Record<string, ComponentType> = Object.fromEntries(
  MARK_NAMES.map((name) => [name, () => <MarkLadder spec={MARKS[name]} />]),
);

// Until the slices that fill them land, these regions hold dev stand-ins, and nothing in production.
const GRID = import.meta.env.DEV ? <StandIn /> : undefined;
const PANE = import.meta.env.DEV ? <PaneStandIn /> : undefined;
const SEARCH = import.meta.env.DEV ? <SearchStandIn /> : undefined;

export function App() {
  useScaleHotkeys();
  const [mark, chooseMark] = useCandidate("mark", MARK_NAMES);
  const comparing = import.meta.env.DEV && mark === COMPARE;
  const barMark = import.meta.env.DEV ? (
    <Mark spec={MARKS[mark === COMPARE ? "five" : mark]} className="size-mark" />
  ) : undefined;

  return (
    <div className="flex h-dvh flex-col bg-ground text-fg">
      <WindowBar search={SEARCH} mark={barMark} />
      {comparing ? (
        <CompareCandidates candidates={LADDERS} />
      ) : (
        <Frame nav={<Navigation />} location={<Breadcrumb />} grid={GRID} pane={PANE} />
      )}
      {import.meta.env.DEV && (
        <footer className="flex items-center gap-4 px-3 py-1 text-xs">
          <DisplayReadout />
          <CandidatePicker slice="mark" names={PICKER_NAMES} current={mark} onChoose={chooseMark} />
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

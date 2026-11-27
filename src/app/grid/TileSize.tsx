import { type RefObject, useEffect } from "react";

import { Dropdown } from "../../ui/Dropdown";
import { getPreferences, updatePreferences, usePreferences } from "../preferences";

// The four sizes a tile can be, each a token in app.css. DECISIONS.md "The grid".
const STEPS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "extra-large", label: "Extra Large" },
] as const;

type Step = (typeof STEPS)[number]["value"];
const DEFAULT_STEP: Step = "medium";

function rem(step: Step) {
  return Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(`--tile-${step}`),
  );
}

/** The step a saved size is nearest, so a size saved before the steps existed still lands on one. */
export function tileStep(saved: number | undefined): Step {
  if (saved === undefined) return DEFAULT_STEP;
  let nearest: Step = DEFAULT_STEP;
  for (const { value } of STEPS) {
    if (Math.abs(rem(value) - saved) < Math.abs(rem(nearest) - saved)) nearest = value;
  }
  return nearest;
}

/** The saved tile size in rem, as the grid lays it out. */
export function tileSize(saved: number | undefined) {
  return rem(tileStep(saved));
}

/** A step bigger or smaller than the saved size, saved as the dropdown saves it. */
function stepTile(by: 1 | -1) {
  const at = STEPS.findIndex((step) => step.value === tileStep(getPreferences().tile));
  const next = STEPS[at + by];
  if (next) updatePreferences({ tile: rem(next.value) });
}

const WHEEL_STEP_PX = 50;

/** Ctrl+wheel over the element steps the tile size, as Explorer's does, and scrolls nothing. */
export function useTileWheel(element: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const over = element.current;
    if (!over) return;
    let turned = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      turned +=
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
          ? event.deltaY
          : Math.sign(event.deltaY) * WHEEL_STEP_PX;
      if (Math.abs(turned) < WHEEL_STEP_PX) return;
      stepTile(turned < 0 ? 1 : -1);
      turned = 0;
    };
    // Not passive, or the wheel would scroll the grid as it steps.
    over.addEventListener("wheel", onWheel, { passive: false });
    return () => over.removeEventListener("wheel", onWheel);
  }, [element]);
}

/** How big the tiles are: a row's height before it is fitted, or a square cell's side. */
export function TileSize() {
  const { tile } = usePreferences();
  return (
    <Dropdown
      label="Tile Size"
      glyph="tileSize"
      align="end"
      options={STEPS}
      value={tileStep(tile)}
      onChange={(step) => updatePreferences({ tile: rem(step) })}
      words="roomy"
    />
  );
}

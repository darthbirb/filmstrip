import { Dropdown } from "../../ui/Dropdown";
import { updatePreferences, usePreferences } from "../preferences";

// The four sizes a tile can be, each a token in app.css. DECISIONS.md "The grid".
const STEPS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "extra-large", label: "Extra large" },
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

/** How big the tiles are: a row's height before it is fitted, or a square cell's side. */
export function TileSize() {
  const { tile } = usePreferences();
  return (
    <Dropdown
      label="Tile size"
      glyph="tileSize"
      align="end"
      options={STEPS}
      value={tileStep(tile)}
      onChange={(step) => updatePreferences({ tile: rem(step) })}
    />
  );
}

import { updatePreferences, usePreferences } from "../preferences";

function token(name: string) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
}

/** The tile sizes the control allows, in rem, read from the token layer. */
export function tileLimits() {
  return { min: token("--tile-min"), max: token("--tile-max"), initial: token("--tile-default") };
}

/** The saved tile size, held within today's limits. */
export function tileSize(saved: number | undefined) {
  const { min, max, initial } = tileLimits();
  return Math.min(max, Math.max(min, saved ?? initial));
}

/** How big the tiles are: a row's height before it is fitted, or a square cell's side. */
export function TileSize() {
  const { tile } = usePreferences();
  const { min, max } = tileLimits();
  return (
    <label className="flex shrink-0 items-center gap-2 px-2 text-caption text-fg-muted">
      Size
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={tileSize(tile)}
        onChange={(event) => updatePreferences({ tile: Number(event.target.value) })}
        className="focus-ring w-24 accent-fg-muted"
      />
    </label>
  );
}

import { useEffect, useSyncExternalStore } from "react";

import { setUiPreferences, uiPreferences } from "../ipc/commands";
import type { LayoutMode } from "./grid/layout";

// The interface's own preferences, kept in filmstrip.config.json. DECISIONS.md "The interface size".
export type Preferences = {
  scale: number;
  widths?: { nav: number; pane: number };
  hidden?: { nav: boolean; pane: boolean };
  /** The grid's tile size, in rem. */
  tile?: number;
  /** The grid's layout: rows that keep each picture's shape, or squares. */
  layout?: LayoutMode;
  /** Whether the pane's details are open, for every item it shows. */
  details?: boolean;
};

/** The interface sizes Settings offers and Ctrl+= and Ctrl+- step through; 1 is Windows' root size. */
export const SCALES = [0.8, 1, 1.25, 1.5, 2];
const DEFAULTS: Preferences = { scale: 1 };
// A write waits this long after the last change, so dragging a splitter saves once.
const SAVE_DELAY_MS = 400;

let current: Preferences = DEFAULTS;
let pendingSave: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** Reads what was saved; anything missing or malformed falls back to the defaults. */
export async function loadPreferences() {
  const stored = await uiPreferences().catch(() => null);
  current = { ...DEFAULTS, ...validated(stored) };
  applyScale();
  notify();
}

export function getPreferences() {
  return current;
}

export function updatePreferences(change: Partial<Preferences>) {
  current = { ...current, ...change };
  applyScale();
  notify();
  clearTimeout(pendingSave);
  pendingSave = setTimeout(() => {
    void setUiPreferences(current).catch(() => undefined);
  }, SAVE_DELAY_MS);
}

export function usePreferences() {
  return useSyncExternalStore(subscribe, getPreferences);
}

/** Ctrl+= and Ctrl+- step the interface size; Ctrl+0 puts it back. */
export function useScaleHotkeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const at = SCALES.indexOf(current.scale);
      let next: number | undefined;
      if (event.key === "=" || event.key === "+")
        next = SCALES[Math.min(at + 1, SCALES.length - 1)];
      else if (event.key === "-") next = SCALES[Math.max(at - 1, 0)];
      else if (event.key === "0") next = DEFAULTS.scale;
      if (next === undefined) return;
      event.preventDefault();
      if (next !== current.scale) updatePreferences({ scale: next });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function applyScale() {
  document.documentElement.style.fontSize =
    current.scale === DEFAULTS.scale ? "" : `${current.scale * 100}%`;
}

function validated(value: unknown): Partial<Preferences> {
  if (typeof value !== "object" || value === null) return {};
  const { scale, widths, hidden, tile, layout, details } = value as Record<string, unknown>;
  const valid: Partial<Preferences> = {};
  if (typeof scale === "number" && Number.isFinite(scale)) valid.scale = nearestScale(scale);
  const savedWidths = pair<number>(widths, "number");
  if (savedWidths) valid.widths = savedWidths;
  const savedHidden = pair<boolean>(hidden, "boolean");
  if (savedHidden) valid.hidden = savedHidden;
  if (typeof tile === "number" && Number.isFinite(tile) && tile > 0) valid.tile = tile;
  if (layout === "justified" || layout === "uniform") valid.layout = layout;
  if (typeof details === "boolean") valid.details = details;
  return valid;
}

/** The step a saved size is nearest, so a size saved under older steps still lands on one. */
function nearestScale(scale: number) {
  return SCALES.reduce((best, step) =>
    Math.abs(step - scale) < Math.abs(best - scale) ? step : best,
  );
}

function pair<T>(value: unknown, type: "number" | "boolean") {
  if (typeof value !== "object" || value === null) return undefined;
  const { nav, pane } = value as Record<string, unknown>;
  return typeof nav === type && typeof pane === type
    ? ({ nav, pane } as { nav: T; pane: T })
    : undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

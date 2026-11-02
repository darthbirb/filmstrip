import { useSyncExternalStore } from "react";

/** The speeds a video plays at, slowest first; the list ends at both ends rather than wrapping. */
export const SPEEDS = [0.5, 1, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

// Held from video to video until the app closes, and 1× at each launch. DECISIONS.md "The pane".
let speed: Speed = 1;
const listeners = new Set<() => void>();

export function getSpeed() {
  return speed;
}

export function setSpeed(next: Speed) {
  if (speed === next) return;
  speed = next;
  for (const listener of listeners) listener();
}

/** The next speed along, `by` places up or down the list, or the same one at its end. */
export function stepSpeed(by: number) {
  const at = SPEEDS.indexOf(speed) + by;
  const next = SPEEDS[Math.min(Math.max(at, 0), SPEEDS.length - 1)];
  if (next !== undefined) setSpeed(next);
}

export function useSpeed() {
  return useSyncExternalStore(subscribe, getSpeed);
}

export function speedLabel(value: number) {
  return `${value}×`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

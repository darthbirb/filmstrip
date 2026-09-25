import { useSyncExternalStore } from "react";

import type { Stayed } from "../../ipc/bindings/Stayed";

/** What an act or an undo could not finish, for the banner over the grid. */
export type Report = {
  sentence: string;
  rows: Stayed[];
  /** A move's rows sit under one heading of their own; everything else is grouped by place. */
  heading?: string;
  retry?: () => void;
  /** What a row still in the Trash offers: going to look at it, or, after Restore, Restore to…. */
  inTrash?: "show" | "restoreTo";
};

// One report at a time: the newest act's is the one that matters. DECISIONS.md "Undo".
let shown: { report: Report; id: number } | null = null;
let count = 0;
const listeners = new Set<() => void>();

export function getReport() {
  return shown?.report ?? null;
}

export function showReport(next: Report | null) {
  shown = next ? { report: next, id: count++ } : null;
  for (const listener of listeners) listener();
}

/** The report showing, and a number that changes each time a new one is shown. */
export function useReport() {
  return useSyncExternalStore(subscribe, () => shown);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

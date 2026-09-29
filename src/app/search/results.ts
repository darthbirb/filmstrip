import { useSyncExternalStore } from "react";

import type { SearchOutcome } from "../../ipc/bindings/SearchOutcome";
import { search } from "../../ipc/commands";

/** The last answer each query had: the header counts it, the grid draws its folders. */
let answers = new Map<string, SearchOutcome>();
const listeners = new Set<() => void>();

/** Runs a query and keeps its answer; the files it found, for the grid and the pane. */
export async function runSearch(query: string) {
  const outcome = await search(query);
  answers = new Map(answers).set(query, outcome);
  for (const listener of listeners) listener();
  return outcome.kind === "found" ? outcome.items : [];
}

export function useSearchOutcome(query: string | undefined) {
  return useSyncExternalStore(subscribe, () =>
    query === undefined ? undefined : answers.get(query),
  );
}

/** Forgets every answer, for tests. */
export function resetSearches() {
  answers = new Map();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

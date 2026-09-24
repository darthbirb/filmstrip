import { useSyncExternalStore } from "react";

import type { Refusal } from "../../ipc/bindings/Refusal";

/** A folder the app would not take, and the source that stands in the way. */
export type Refused = { why: Refusal; clash: string | null; path: string };

/** What just happened at the person's request, as the foot of navigation says it. */
export type FootNews =
  | { kind: "refused"; refused: Refused }
  /** An act that changed the disk, and the batch its Undo takes back. */
  | { kind: "done"; line: string; batchId: string }
  | { kind: "undone"; line: string }
  | { kind: "nothing" };

// One slot: whatever arrives last replaces what was there. DECISIONS.md "Undo".
let news: FootNews | null = null;
const listeners = new Set<() => void>();

export function getNews() {
  return news;
}

export function setNews(next: FootNews | null) {
  news = next;
  for (const listener of listeners) listener();
}

export function useNews() {
  return useSyncExternalStore(subscribeNews, getNews);
}

export function subscribeNews(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

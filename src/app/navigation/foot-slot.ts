import { useSyncExternalStore } from "react";

import type { Refusal } from "../../ipc/bindings/Refusal";

/** A folder the app would not take, and the source that stands in the way. */
export type Refused = { why: Refusal; clash: string | null; path: string };

/** What just happened at the person's request, as the foot of navigation says it. */
export type FootNews =
  | { kind: "refused"; refused: Refused }
  /** A destination key that moved nothing, and why. */
  | { kind: "keyRefused"; line: string; detail?: string }
  /** An act that changed the disk, and the batch its Undo takes back. */
  | { kind: "done"; line: string; batchId: string }
  /** What an undo brought back, and the batch it took back. */
  | { kind: "undone"; line: string; batchId?: string }
  | { kind: "nothing" }
  /** Ctrl+V with no files on the clipboard. */
  | { kind: "noFiles" };

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

/** News that answers a key rather than an act, so it goes at the next key or click. */
export function sayOnce(next: FootNews) {
  setNews(next);
  const said = performance.now();
  const clear = (event: Event) => {
    // The key or click that said it may still be on its way through the page.
    if (event.timeStamp < said) return;
    window.removeEventListener("keydown", clear, true);
    window.removeEventListener("pointerdown", clear, true);
    if (news === next) setNews(null);
  };
  window.addEventListener("keydown", clear, true);
  window.addEventListener("pointerdown", clear, true);
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

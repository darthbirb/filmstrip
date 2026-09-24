import { useSyncExternalStore } from "react";

import { getNews, type Refused, setNews, subscribeNews } from "./foot-slot";

export type { Refused };

// There is only ever one: a folder refused while the last is still showing takes its place,
// because two bands are two folders. DECISIONS.md "Places, not queries".

export function getRefused() {
  const news = getNews();
  return news?.kind === "refused" ? news.refused : null;
}

/** Shows a refusal in the foot's slot, or clears it; clearing leaves any other news alone. */
export function setRefused(next: Refused | null) {
  if (next) setNews({ kind: "refused", refused: next });
  else if (getNews()?.kind === "refused") setNews(null);
}

export function useRefused() {
  return useSyncExternalStore(subscribeNews, getRefused);
}

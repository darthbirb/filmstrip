import { refreshIndex } from "./navigation/index-store";

// The app changed the library itself: navigation reads it again, and every surface showing
// part of it reads its part again. DECISIONS.md "Undo".

const listeners = new Set<() => void>();

/** Calls back each time the app has changed the library on disk. */
export function whenLibraryChanges(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function libraryChanged() {
  await refreshIndex().catch(() => undefined);
  for (const listener of listeners) listener();
}

import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import type { Failure } from "../../ipc/bindings/Failure";
import type { Progress } from "../../ipc/bindings/Progress";
import { indexFailures, indexProgress, retryFailedJobs } from "../../ipc/commands";

/** How far the background work has got, and what it could not read. DECISIONS.md "Background work". */
type Work = { progress: Progress | null; failures: Failure[] };

let snapshot: Work = { progress: null, failures: [] };
const listeners = new Set<() => void>();

/** Follows the work from where it already is; the queue reports every change it makes. */
export async function watchWork() {
  await report(await indexProgress().catch(() => null));
  await listen<Progress>("job-progress", (event) => {
    void report(event.payload);
  }).catch(() => undefined);
}

export function useWork() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Tries every failed job again, and reads back what is still failing. */
export async function retryFailures() {
  await retryFailedJobs().catch(() => 0);
  await loadFailures();
}

export async function loadFailures() {
  const failures = await indexFailures().catch(() => []);
  publish({ ...snapshot, failures });
}

/** Forgets everything, for tests. */
export function resetWork() {
  publish({ progress: null, failures: [] });
}

// The list is only read when the count of failures moves, so a busy walk does not fetch it per job.
async function report(progress: Progress | null) {
  const before = snapshot.progress?.failed ?? 0;
  publish({ ...snapshot, progress });
  if (progress && progress.failed !== before) await loadFailures();
}

function publish(next: Work) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

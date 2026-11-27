// How many sends hold each file; one held by any is going, and a second press on it sends nothing.
const going = new Map<number, number>();
const byJob = new Map<number, readonly number[]>();
// A job can be heard ending before its start has been answered.
const endedUnheld = new Set<number>();

function take(itemIds: readonly number[]) {
  for (const id of itemIds) going.set(id, (going.get(id) ?? 0) + 1);
}

function letGo(itemIds: readonly number[]) {
  for (const id of itemIds) {
    const left = (going.get(id) ?? 0) - 1;
    if (left > 0) going.set(id, left);
    else going.delete(id);
  }
}

/**
 * Runs `work` for files none of which a delete or a move is still sending; otherwise nothing, and
 * hands back null. DECISIONS.md "One press, one act".
 */
export async function once<T>(itemIds: readonly number[], work: () => Promise<T>) {
  if (itemIds.some((id) => going.has(id))) return null;
  take(itemIds);
  try {
    return await work();
  } finally {
    letGo(itemIds);
  }
}

/** Keeps files going while the job on the queue that sends them runs, until it is heard to end. */
export function goingUntilEnd(jobId: number, itemIds: readonly number[]) {
  if (endedUnheld.delete(jobId)) return;
  take(itemIds);
  byJob.set(jobId, itemIds);
}

/** A job that sends files has ended, however it ended, and its files are free again. */
export function jobEnded(jobId: number) {
  const itemIds = byJob.get(jobId);
  if (!itemIds) {
    endedUnheld.add(jobId);
    return;
  }
  byJob.delete(jobId);
  letGo(itemIds);
}

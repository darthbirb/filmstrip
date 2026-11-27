import type { Progress } from "../../ipc/bindings/Progress";
import { indexProgress } from "../../ipc/commands";
import { unasked } from "../failure";

// How many sends hold each file; one held by any is going, and a second press on it sends nothing.
const going = new Map<number, number>();
// Each job on the queue holding files, whether the queue has listed it yet, and what waits on it.
const byJob = new Map<
  number,
  { itemIds: readonly number[]; listed: boolean; ended: (() => void) | undefined }
>();

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

/**
 * Keeps files going while the job on the queue that sends them is there: until its end is heard,
 * or the queue no longer lists it, however it left; then `ended` runs. One already gone lets them
 * go at once, and a job given the id of one that ended unheard takes its place.
 */
export async function goingUntilEnd(jobId: number, itemIds: readonly number[], ended?: () => void) {
  jobEnded(jobId);
  take(itemIds);
  byJob.set(jobId, { itemIds, listed: false, ended });
  const asked = new Set(byJob.keys());
  const now = await indexProgress().catch(unasked);
  if (now) jobsListed(now, asked);
}

/**
 * A job that sends files has ended, however it ended: its files are free again, and what waited
 * on it runs.
 */
export function jobEnded(jobId: number) {
  const job = byJob.get(jobId);
  if (!job) return;
  byJob.delete(jobId);
  letGo(job.itemIds);
  job.ended?.();
}

/**
 * What the queue lists: a job it listed before and lists no more has left it. A report sent
 * before a job was listed says nothing of it, except one asked for after the jobs in `started`
 * had started.
 */
export function jobsListed(
  progress: Pick<Progress, "moves" | "deletes">,
  started: ReadonlySet<number> = new Set(),
) {
  const there = new Set([...progress.moves, ...progress.deletes].map((one) => one.jobId));
  for (const [jobId, job] of byJob) {
    if (there.has(jobId)) job.listed = true;
    else if (job.listed || started.has(jobId)) jobEnded(jobId);
  }
}

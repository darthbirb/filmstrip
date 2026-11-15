import type { Due } from "../../ipc/bindings/Due";
import type { Emptied } from "../../ipc/bindings/Emptied";
import type { Expired } from "../../ipc/bindings/Expired";
import type { Limit } from "../../ipc/bindings/Limit";
import type { Tally } from "../../ipc/bindings/Tally";
import { formatBytes, formatCount, formatTime } from "../../lib/format";

// How the Trash keeping its limits, and emptying it, is worded: in Settings, at the foot, and in a
// restore's banner.
// Artboards › The Trash's limits.

const GB = 2 ** 30;
const files = (n: number) => `${formatCount(n)} ${n === 1 ? "file" : "files"}`;

/** A time to live: "30 days", or "1 year". */
export const period = (days: number) => (days === 365 ? "1 year" : `${formatCount(days)} days`);

/** A total size, as its dropdown names it. */
export const totalOf = (bytes: number) => formatBytes(bytes);

/** Why a file that expired is in the Recycle Bin, in the banner's Reason column. */
export function expiredReason(limit: Limit) {
  return limit.kind === "age"
    ? `Expired after ${period(limit.days)}`
    : `Expired to keep the Trash under ${totalOf(limit.bytes)}`;
}

/** What the Trash holds, and against its total: "312 files · 18.4 GB of 25 GB". */
export function heldLine(held: Tally, totalGb: number | null) {
  if (held.count === 0) return "Nothing in it";
  const of = totalGb === null ? "" : ` of ${totalOf(totalGb * GB)}`;
  return `${files(held.count)} · ${formatBytes(held.bytes)}${of}`;
}

/** A sentence in pieces, the terms it names apart, so they can stand out. */
export type Said = readonly (string | { term: string })[];

export const USUAL =
  "Past a limit, the oldest go to the Windows Recycle Bin. Checked at launch and every hour.";

/** The line under the limits: what the next run sends and when, or the usual line when nothing. */
export function dueLine(
  due: Due,
  keepDays: number | null,
  totalGb: number | null,
  at: number,
): Said {
  const { byAge, bySize } = due;
  const count = byAge.count + bySize.count;
  if (count === 0) return [USUAL];
  const size = formatBytes(byAge.bytes + bySize.bytes);
  const go = `${count === 1 ? "goes" : "go"} to the Recycle Bin at `;
  const when = { term: formatTime(at) };
  const ago = `deleted over ${period(keepDays ?? 0)} ago`;
  const under = `to keep the Trash under ${totalOf((totalGb ?? 0) * GB)}`;
  if (bySize.count === 0) return [{ term: files(count) }, `, ${size}, ${ago}, ${go}`, when, "."];
  if (byAge.count === 0)
    return [{ term: files(count) }, `, ${size}, the oldest, ${go}`, when, ` ${under}.`];
  return [
    { term: files(count) },
    `, ${size}, ${go}`,
    when,
    `: ${formatCount(byAge.count)} ${ago}, ${formatCount(bySize.count)} ${under}.`,
  ];
}

/** The line at the foot after a run sent something. */
export function expiredLine({ byAge, bySize, keepDays, totalBytes }: Expired) {
  const count = byAge + bySize;
  const went = `${files(count)} went to the Recycle Bin`;
  const under = `to keep the Trash under ${totalOf(totalBytes ?? 0)}`;
  if (bySize === 0) {
    const they = count === 1 ? "it was" : "they were";
    return `${went}, ${period(keepDays ?? 0)} after ${they} deleted.`;
  }
  if (byAge === 0) return `${went}, ${count === 1 ? "the oldest" : "oldest first"}, ${under}.`;
  return `${went}: ${formatCount(byAge)} past ${period(keepDays ?? 0)}, ${formatCount(bySize)} ${under}.`;
}

/** The band after a run the Recycle Bin refused more files of than the last. */
export function refusedLine(refused: number) {
  const one = refused === 1;
  return {
    sentence: `The Recycle Bin could not take ${files(refused)} that expired, so ${one ? "it stays" : "they stay"} in the Trash.`,
    detail: `${one ? "Its" : "Their"} drive may have no Recycle Bin, or it is off or too small.`,
  };
}

/** Empty Trash…'s question: how many files, how much space, and that nothing brings them back. */
export function emptyQuestion(held: Tally): Said {
  return [
    "Delete the ",
    { term: files(held.count) },
    " in the Trash, ",
    { term: formatBytes(held.bytes) },
    ", for good? They do not go to the Recycle Bin, and Undo cannot bring them back.",
  ];
}

/** The head while the Trash empties: "Emptying · 120 of 312 files". */
export function emptyingLine(done: number, whole: number) {
  return `Emptying · ${formatCount(done)} of ${files(whole)}`;
}

/** The line at the foot once the Trash has emptied, every file gone. */
export function emptiedLine({ deleted, bytes }: Emptied) {
  return `Emptied the Trash: ${files(deleted)}, ${formatBytes(bytes)}, deleted for good.`;
}

/** The band at the foot when some files would not go, which stay in the Trash. */
export function keptLine({ deleted, kept, inUse }: Emptied) {
  const one = kept === 1;
  const why = inUse
    ? `${one ? "is" : "are"} open in another app and ${one ? "stays" : "stay"}`
    : `could not be deleted and ${one ? "stays" : "stay"}`;
  return `Deleted ${formatCount(deleted)} of ${files(deleted + kept)}. ${formatCount(kept)} ${why} in the Trash.`;
}

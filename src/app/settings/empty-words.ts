import type { Emptied } from "../../ipc/bindings/Emptied";
import type { Tally } from "../../ipc/bindings/Tally";
import { files, formatBytes, formatCount } from "../../lib/format";

// How Empty Trash… asks, counts and ends. Artboards › The Trash in the Recycle Bin.

/** A sentence in pieces, each term it names set apart to be drawn in `fg`. */
export type Said = readonly (string | { term: string })[];

/** The section's head: what the Trash holds, or nothing. */
export function heldLine(held: Tally) {
  if (held.count === 0) return "Nothing in it";
  return `${files(held.count)} · ${formatBytes(held.bytes)}`;
}

/** The question under the head: how many and how much, that only they go, and for good. */
export function emptyQuestion(held: Tally): Said {
  const one = held.count === 1;
  return [
    "Delete the ",
    { term: one ? "file" : files(held.count) },
    " the library sent to the Recycle Bin, ",
    { term: formatBytes(held.bytes) },
    `, for good? Only ${one ? "it goes" : "these go"}; the rest of the Recycle Bin is left as it is. Undo cannot bring ${one ? "it" : "them"} back.`,
  ];
}

/** The head as emptying goes. */
export const emptyingLine = (done: number, whole: number) =>
  `Emptying · ${formatCount(done)} of ${files(whole)}`;

/** The foot once every file counted went. */
export function emptiedLine({ deleted, bytes }: Emptied) {
  return `Emptied the Trash: ${files(deleted)}, ${formatBytes(bytes)}, deleted for good.`;
}

/** The foot when some were skipped: what went, then those no longer in the bin and those kept. */
export function skippedLine({ deleted, gone, kept }: Emptied) {
  const whole = deleted + gone + kept;
  const lead =
    deleted === 0
      ? `Emptied none of the ${files(whole)}.`
      : `Emptied ${formatCount(deleted)} of ${files(whole)} for good.`;
  const parts = [
    gone > 0 && `${formatCount(gone)} ${gone === 1 ? "was" : "were"} no longer in the Recycle Bin`,
    kept > 0 &&
      `${formatCount(kept)} would not go and ${kept === 1 ? "stays" : "stay"} in the Trash`,
  ].filter((part): part is string => typeof part === "string");
  return parts.length === 0 ? lead : `${lead} ${parts.join(", and ")}.`;
}

/** The banner's sentence over the files that stayed: what went, counted, or turned round when none did. */
export function emptiedBannerLine({ deleted, gone, kept, stayed }: Emptied) {
  const whole = deleted + gone + kept;
  if (deleted > 0)
    return `${formatCount(deleted)} of ${files(whole)} ${deleted === 1 ? "was" : "were"} deleted for good`;
  const [first] = stayed;
  const what = kept === 1 && first ? first.name : `The ${files(kept)}`;
  return `${what} could not be deleted for good`;
}

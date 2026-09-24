import type { Batch } from "../../ipc/bindings/Batch";
import type { Reason } from "../../ipc/bindings/Reason";
import type { Stayed } from "../../ipc/bindings/Stayed";
import type { UndoReport } from "../../ipc/bindings/UndoReport";
import type { AppError } from "../../ipc/commands";
import { formatCount } from "../../lib/format";

// Every sentence an act and its undo say, as Artboards › Undo words them. DECISIONS.md "Undo".

const files = (n: number) => `${formatCount(n)} ${n === 1 ? "file" : "files"}`;
const are = (n: number) => (n === 1 ? "is" : "are");

/** The line at the foot after an act. `stayed` counts what the act could not carry. */
export function actLine({ act, files: carried }: Batch, stayed = 0): string {
  const whole = carried + stayed;
  const rest = `The other ${formatCount(stayed)} ${are(stayed)} in the banner.`;
  switch (act.kind) {
    case "move":
      if (stayed > 0)
        return `Moved ${formatCount(carried)} of ${files(whole)} to ${act.to}. ${rest}`;
      return `Moved ${act.one ?? files(carried)} to ${act.to}.`;
    case "delete":
      if (stayed > 0) return `Deleted ${formatCount(carried)} of ${files(whole)}. ${rest}`;
      return `Deleted ${act.one ?? files(carried)}.`;
    case "renameFile":
    case "renameFolder":
      return `Renamed ${act.from} to ${act.to}.`;
    case "createFolder":
      return `Created ${act.name} in ${act.parent}.`;
    case "moveFolder":
      return `Moved ${act.name} to ${act.to}.`;
    case "deleteFolder":
      if (carried === 0) return `Deleted ${act.name}.`;
      if (act.into)
        return `Deleted ${act.name}. Its ${files(carried)} ${are(carried)} in ${act.into}.`;
      return `Deleted ${act.name} and its ${files(carried)}.`;
  }
}

/** The line after an undo that brought all of its act back. */
export function undoneLine({ batch }: UndoReport): string {
  const { act, files: carried } = batch;
  switch (act.kind) {
    case "move":
    case "delete": {
      const what = act.one ?? files(carried);
      const were = act.one ? "is" : are(carried);
      return act.from
        ? `${what} ${were} back in ${act.from}.`
        : `${what} ${were} back where they were.`;
    }
    case "renameFile":
    case "renameFolder":
      return `${act.to} is ${act.from} again.`;
    case "createFolder":
      return `${act.name} is gone from ${act.parent}.`;
    case "moveFolder":
      return `${act.name} is back in ${act.from}.`;
    case "deleteFolder":
      if (carried === 0) return `${act.name} is back in ${act.parent}.`;
      return `${act.name} and its ${files(carried)} are back in ${act.parent}.`;
  }
}

/** The banner's sentence for an undo that came back in part: counted, or turned round when none did. */
export function undoBannerLine({ batch, filesBack, stayed }: UndoReport): string {
  const { act, files: carried } = batch;
  switch (act.kind) {
    case "move":
    case "delete": {
      const home = act.from ? `back in ${act.from}` : "back where they were";
      if (filesBack > 0) {
        return `${formatCount(filesBack)} of ${files(carried)} ${are(filesBack)} ${home}`;
      }
      const what = act.one ?? `The ${files(carried)}`;
      return act.from ? `${what} could not go back to ${act.from}` : `${what} could not go back`;
    }
    case "renameFile":
    case "renameFolder":
      return `${act.to} could not be ${act.from} again`;
    case "createFolder":
      return `${act.name} is still in ${act.parent}`;
    case "moveFolder":
      return `${act.name} could not go back to ${act.from}`;
    case "deleteFolder": {
      const folderStayed = stayed.some((one) => one.kind === "folder" && one.name === act.name);
      if (folderStayed) return `${act.name} could not go back to ${act.parent}`;
      return `${act.name} and ${formatCount(filesBack)} of its ${files(carried)} are back in ${act.parent}`;
    }
  }
}

/** The banner's sentence for a move that finished in part, or not at all. */
export function movedBannerLine(moved: number, whole: number, to: string, one?: string) {
  if (moved > 0) return `${formatCount(moved)} of ${files(whole)} moved to ${to}`;
  return `${one ?? `The ${files(whole)}`} could not go to ${to}`;
}

/** The banner's sentence for a delete that finished in part, or not at all. */
export function deletedBannerLine(trashed: number, whole: number, one?: string) {
  if (trashed > 0) return `${formatCount(trashed)} of ${files(whole)} went to the Trash`;
  return `${one ?? `The ${files(whole)}`} could not go to the Trash`;
}

/** What a name field says under itself when the name was refused; nothing for any other failure. */
export function refusedName(error: unknown): string | null {
  const { kind, reason } = (error ?? {}) as AppError;
  if (kind !== "refused" || !reason) return null;
  if (reason.kind !== "nameTaken") return `${reasonText(reason)}.`;
  return `${reason.place} already has a ${reason.folder ? "folder" : "file"} named ${reason.name}.`;
}

/** Why one row stayed, in the banner's Reason column. */
export function reasonText(reason: Reason): string {
  switch (reason.kind) {
    case "nameTaken":
      return `Name taken in ${reason.place}`;
    case "folderGone":
      return `${reason.name} is gone`;
    case "inUse":
      return "Open in another app";
    case "permissionDenied":
      return "Permission denied";
    case "notOnDisk":
      return "No longer on disk";
    case "holds":
      return reason.more > 0
        ? `Holds ${reason.name} and ${reason.more} more`
        : `Holds ${reason.name}`;
    case "other":
      return reason.message.charAt(0).toUpperCase() + reason.message.slice(1);
  }
}

export type StayedGroup = { heading: string; rows: Stayed[] };

/**
 * The rows under the place each is still in, one heading per place. Places are named from the
 * nearest folder they share, so "Inbox" and "Inbox › Day 2" read as where they are.
 */
export function stayedGroups(stayed: readonly Stayed[]): StayedGroup[] {
  const keyOf = (one: Stayed) =>
    one.at.kind === "trash"
      ? "trash"
      : `${one.reason.kind === "notOnDisk"}:${one.at.path.join("/")}`;
  const groups = new Map<string, Stayed[]>();
  for (const one of stayed) groups.set(keyOf(one), [...(groups.get(keyOf(one)) ?? []), one]);

  const paths = [...groups.values()].flatMap(([first]) =>
    first && first.at.kind === "folder" ? [first.at.path] : [],
  );
  const shared = sharedDepth(paths);
  return [...groups.values()]
    .map((rows) => {
      const [first] = rows;
      if (!first || first.at.kind === "trash")
        return { heading: "Still in the Trash", rows, depth: 0 };
      const path = first.at.path;
      const place = path.slice(Math.max(Math.min(shared, path.length) - 1, 0)).join(" › ");
      const gone = first.reason.kind === "notOnDisk";
      return { heading: `${gone ? "Gone from" : "Still in"} ${place}`, rows, depth: path.length };
    })
    .sort((a, b) => a.depth - b.depth)
    .map(({ heading, rows }) => ({ heading, rows }));
}

/** How many leading folders every path shares; a single path shares all of it. */
function sharedDepth(paths: readonly (readonly string[])[]) {
  const [first, ...rest] = paths;
  if (!first) return 0;
  let depth = first.length;
  for (const path of rest) {
    let at = 0;
    while (at < depth && at < path.length && path[at] === first[at]) at++;
    depth = at;
  }
  return depth;
}

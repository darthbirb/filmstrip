import type { Batch } from "../../ipc/bindings/Batch";
import type { Change } from "../../ipc/bindings/Change";
import type { Reason } from "../../ipc/bindings/Reason";
import type { Stayed } from "../../ipc/bindings/Stayed";
import type { UndoReport } from "../../ipc/bindings/UndoReport";
import type { AppError } from "../../ipc/commands";
import { files, formatBytes, formatCount, formatCounted } from "../../lib/format";

// Every sentence an act and its undo say, as Artboards › Undo words them. DECISIONS.md "Undo".

const are = (n: number) => (n === 1 ? "is" : "are");
/** Lisbon’s, and Trips’: a name that ends in s takes the apostrophe alone. */
const whose = (name: string) => (name.endsWith("s") ? `${name}’` : `${name}’s`);

/** The line at the foot after an act. `stayed` counts what the act could not carry. */
export function actLine(batch: Batch, stayed = 0): string {
  const { act, files: carried } = batch;
  const whole = carried + stayed;
  const rest = `The other ${formatCount(stayed)} ${are(stayed)} in the banner.`;
  switch (act.kind) {
    case "move":
      if (stayed > 0)
        return `Moved ${formatCount(carried)} of ${files(whole)} to ${act.to}. ${rest}`;
      return `Moved ${act.one ?? files(carried)} to ${act.to}.`;
    case "delete":
      if (stayed > 0)
        return `Moved ${formatCount(carried)} of ${files(whole)} to the Recycle Bin. ${rest}`;
      return `Moved ${act.one ?? files(carried)} to the Recycle Bin.`;
    case "renameFile":
    case "renameFolder":
      return `Renamed ${act.from} to ${act.to}.`;
    case "createFolder":
      return `Created ${act.name} in ${act.parent}.`;
    case "moveFolder":
      return `Moved ${act.name} to ${act.to}.`;
    case "restore": {
      const where = act.to ? ` to ${act.to}` : "";
      if (stayed > 0) return `Restored ${formatCount(carried)} of ${files(whole)}${where}. ${rest}`;
      return `Restored ${act.one ?? files(carried)}${where}.`;
    }
    case "deleteFolder":
      if (carried === 0) return `Deleted ${act.name}.`;
      if (act.into)
        return `Deleted ${act.name}. Its ${files(carried)} ${are(carried)} in ${act.into}.`;
      return `Deleted ${act.name} and its ${files(carried)}.`;
    case "addTag":
      return `Added ${act.tag} to ${files(carried)}.`;
    case "removeTag":
      return `Took ${act.tag} off ${files(carried)}.`;
    case "retag":
      return retagLine(act.change, carried, batch.folders);
    case "copy":
      if (stayed > 0)
        return `Copied ${formatCount(carried)} of ${files(whole)} to ${act.to}. ${rest}`;
      return `Copied ${copiedWhat(act, carried)} to ${act.to}.`;
  }
}

type CopyAct = Extract<Batch["act"], { kind: "copy" }>;

/** What came in at a copy's top: one file, one folder with its files, or folders and files counted. */
function copiedWhat(act: CopyAct, carried: number) {
  if (act.one) return act.one;
  if (act.folder) return carried > 0 ? `${act.folder} and its ${files(carried)}` : act.folder;
  if (act.folders > 0) return filesAndFolders(carried, act.folders) ?? folders(act.folders);
  return files(carried);
}

/**
 * The line at the foot after a copy that was stopped: what came in, counted against what it
 * carried. Artboards › Bringing files in.
 */
export function copyCancelledLine(batch: Batch, whole: number): string {
  const to = batch.act.kind === "copy" ? batch.act.to : "";
  return `Copied ${formatCount(batch.files)} of ${files(whole)} to ${to}.`;
}

/** The banner's sentence for a copy that left something out: counted, or turned round when none came. */
export function copiedBannerLine(came: number, whole: number, to: string, one?: string) {
  if (came > 0) return `${formatCount(came)} of ${files(whole)} came into ${to}`;
  return `${one ?? `The ${files(whole)}`} could not come into ${to}`;
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
    case "restore":
      return `${act.one ?? files(carried)} ${act.one ? "is" : are(carried)} back in the Trash.`;
    case "moveFolder":
      return `${act.name} is back in ${act.from}.`;
    case "deleteFolder":
      if (carried === 0) return `${act.name} is back in ${act.parent}.`;
      return `${act.name} and its ${files(carried)} are back in ${act.parent}.`;
    case "addTag":
      return `Removed ${act.tag} from ${files(carried)}.`;
    case "removeTag":
      return `${act.tag} is back on ${files(carried)}.`;
    case "retag":
      return retagUndone(act.change, carried, batch.folders);
    case "copy": {
      const what = copiedWhat(act, carried);
      return `${what} left ${act.to} for the Trash.`;
    }
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
    case "restore":
      if (filesBack > 0) {
        return `${formatCount(filesBack)} of ${files(carried)} ${are(filesBack)} back in the Trash`;
      }
      return `${act.one ?? `The ${files(carried)}`} could not go back to the Trash`;
    case "moveFolder":
      return `${act.name} could not go back to ${act.from}`;
    case "deleteFolder": {
      const folderStayed = stayed.some((one) => one.kind === "folder" && one.name === act.name);
      if (folderStayed) return `${act.name} could not go back to ${act.parent}`;
      return `${act.name} and ${formatCount(filesBack)} of its ${files(carried)} are back in ${act.parent}`;
    }
    case "addTag":
      return `${act.tag} could not come off ${files(carried)}`;
    case "removeTag":
      return `${act.tag} could not go back on ${files(carried)}`;
    case "retag": {
      const { kind, was } = changed(act.change);
      return `${capital(kind)} ${was} could not come back`;
    }
    case "copy":
      if (filesBack > 0) {
        return `${formatCount(filesBack)} of ${files(carried)} left ${act.to} for the Trash`;
      }
      return `${copiedWhat(act, carried)} could not leave ${act.to}`;
  }
}

/**
 * The banner's sentence for a redo that went in part: counted, or turned round when none went,
 * as the act's own banner says it.
 */
export function redoBannerLine({ batch, filesBack, stayed }: UndoReport): string {
  const { act, files: carried } = batch;
  switch (act.kind) {
    case "move":
      return movedBannerLine(filesBack, carried, act.to, act.one ?? undefined);
    case "delete":
      return deletedBannerLine(filesBack, carried, act.one ?? undefined);
    case "restore":
      return restoredBannerLine(filesBack, carried, act.to, false, act.one ?? undefined);
    case "copy":
      return copiedBannerLine(filesBack, carried, act.to, act.one ?? undefined);
    case "renameFile":
    case "renameFolder":
      return `${act.from} could not be ${act.to} again`;
    case "createFolder":
      return `${act.name} could not come back to ${act.parent}`;
    case "moveFolder":
      return `${act.name} could not go to ${act.to}`;
    case "deleteFolder": {
      const folderStayed = stayed.some((one) => one.kind === "folder" && one.name === act.name);
      if (!folderStayed)
        return `${act.name} went with ${formatCount(filesBack)} of its ${files(carried)}`;
      return folderStayedBanner(act.name, filesBack, carried, act.into);
    }
    case "addTag":
      return `${act.tag} could not go on ${files(carried)}`;
    case "removeTag":
      return `${act.tag} could not come off ${files(carried)}`;
    case "retag": {
      const { kind, was } = changed(act.change);
      return `${capital(kind)} ${was} could not change again`;
    }
  }
}

const folders = (n: number) => formatCounted(n, "folder");

/** "38 files and 2 folders", either alone, or nothing when the act touched neither. */
export function filesAndFolders(fileCount: number, folderCount: number): string | null {
  const parts = [
    ...(fileCount > 0 ? [files(fileCount)] : []),
    ...(folderCount > 0 ? [folders(folderCount)] : []),
  ];
  return parts.length > 0 ? parts.join(" and ") : null;
}

/** A tag by its words, a label as `key: value`. */
const termText = (key: string | null, value: string) => (key ? `${key}: ${value}` : value);

const capital = (line: string) => line.charAt(0).toUpperCase() + line.slice(1);

type Changed = {
  verb: "rename" | "merge" | "delete";
  kind: "the tag" | "the label key" | "the label";
  was: string;
  is: string;
};

/** What a change on the tags screen was, now and before, its verb, and what kind of term it is. */
function changed(change: Change): Changed {
  switch (change.kind) {
    case "renameTag":
      return { verb: "rename", kind: "the tag", was: change.from, is: change.to };
    case "renameKey":
      return { verb: "rename", kind: "the label key", was: change.from, is: change.to };
    case "mergeTags":
      return { verb: "merge", kind: "the tag", was: change.from, is: change.into };
    case "mergeKeys":
      return { verb: "merge", kind: "the label key", was: change.from, is: change.into };
    case "deleteTag":
      return { verb: "delete", kind: "the tag", was: change.tag, is: change.tag };
    case "deleteKey":
      return { verb: "delete", kind: "the label key", was: change.key, is: change.key };
    case "renameValue":
      return {
        verb: "rename",
        kind: "the label",
        was: termText(change.key, change.from),
        is: termText(change.key, change.to),
      };
    case "mergeValues":
      return {
        verb: "merge",
        kind: "the label",
        was: termText(change.key, change.from),
        is: termText(change.key, change.into),
      };
    case "deleteValue":
      return { verb: "delete", kind: "the label", was: termText(change.key, change.value), is: "" };
  }
}

/** The line after a rename, a merge or a delete on the tags screen. Artboards › Tags. */
function retagLine(change: Change, fileCount: number, folderCount: number) {
  const { verb, kind, was, is } = changed(change);
  const what = filesAndFolders(fileCount, folderCount);
  if (verb === "delete")
    return what ? `Deleted ${kind} ${was} from ${what}.` : `Deleted ${kind} ${was}.`;
  const done =
    verb === "rename" ? `Renamed ${kind} ${was} to ${is}` : `Merged ${kind} ${was} into ${is}`;
  return what ? `${done} on ${what}.` : `${done}.`;
}

/** The line after undoing one: the term is back where it was, under its own words. */
function retagUndone(change: Change, fileCount: number, folderCount: number) {
  const { verb, kind, was, is } = changed(change);
  if (verb === "rename") return `${capital(kind)} ${is} is ${was} again.`;
  const what = filesAndFolders(fileCount, folderCount);
  return what ? `${capital(kind)} ${was} is back on ${what}.` : `${capital(kind)} ${was} is back.`;
}

/**
 * The line at the foot after a move between drives that was stopped: what went, counted against
 * what it carried.
 */
export function moveStoppedLine(batch: Batch, whole: number, to: string): string {
  return `Moved ${formatCount(batch.files)} of ${files(whole)} to ${to}.`;
}

/** The banner's sentence for a move that finished in part, or not at all. */
export function movedBannerLine(moved: number, whole: number, to: string, one?: string) {
  if (moved > 0) return `${formatCount(moved)} of ${files(whole)} moved to ${to}`;
  return `${one ?? `The ${files(whole)}`} could not go to ${to}`;
}

/**
 * The line at the foot after a delete on the queue that was stopped: what went to the Recycle
 * Bin, counted against what it was asked to delete.
 */
export function deleteStoppedLine(batch: Batch, whole: number): string {
  return `Moved ${formatCount(batch.files)} of ${files(whole)} to the Recycle Bin.`;
}

/** The banner's sentence for a delete that finished in part, or not at all. */
export function deletedBannerLine(trashed: number, whole: number, one?: string) {
  if (trashed > 0) return `${formatCount(trashed)} of ${files(whole)} went to the Recycle Bin`;
  return `${one ?? `The ${files(whole)}`} could not go to the Recycle Bin`;
}

/**
 * The banner's sentence for a restore that finished in part, or not at all. `to` is where they
 * were going, when that was one place; `back` when it was where they came from.
 */
export function restoredBannerLine(
  restored: number,
  whole: number,
  to: string | null,
  back: boolean,
  one?: string,
) {
  if (restored > 0) {
    const where = to ? `${back ? "back in" : "in"} ${to}` : "back where they were";
    return `${formatCount(restored)} of ${files(whole)} ${are(restored)} ${where}`;
  }
  const what = one ?? `The ${files(whole)}`;
  if (!to) return `${what} could not go back`;
  return `${what} could not go ${back ? "back " : ""}to ${to}`;
}

/** The question a folder with files in it asks before it is deleted. */
export const holdsLine = (name: string, held: number) => `${name} holds ${files(held)}`;

/**
 * The line at the foot after a folder's delete that kept the folder: what went is the act, and
 * it is undone as any move or delete of files is. `into` is the sorting source, or the Recycle Bin.
 */
export function folderStayedLine(
  name: string,
  carried: number,
  whole: number,
  into: string | null,
) {
  const what =
    carried === whole
      ? `${whose(name)} ${files(whole)}`
      : `${formatCount(carried)} of ${whose(name)} ${files(whole)}`;
  const act = `Moved ${what} to ${into ?? "the Recycle Bin"}.`;
  return `${act} ${name} is in the banner.`;
}

/** The banner's sentence for a folder that stayed: where its files went, counted, or why not. */
export function folderStayedBanner(
  name: string,
  carried: number,
  whole: number,
  into: string | null,
) {
  const place = into ?? "the Trash";
  if (whole === 0) return `${name} could not go`;
  if (carried === whole)
    return `${name} could not go · its ${files(whole)} ${are(whole)} in ${place}`;
  if (carried === 0)
    return `${whose(name)} ${files(whole)} could not go to ${place} · ${name} stayed`;
  const counted = `${formatCount(carried)} of ${whose(name)} ${files(whole)}`;
  return `${counted} ${are(carried)} in ${place} · ${name} stayed`;
}

/** Where a file that stayed is, by its folder's name, when it is in one. */
const folderOf = (one: Stayed) => (one.at.kind === "folder" ? (one.at.path.at(-1) ?? null) : null);

/**
 * What the foot says when the Recycle Bin would not take files Delete sent it: what went, when
 * any did, out of all it was asked to delete, then where the refused stay. `asked` counts those
 * waiting on the question a drive with no Recycle Bin asks. Artboards › The Trash in the Recycle Bin.
 */
export function binRefusedLine(rows: readonly Stayed[], trashed = 0, asked = 0) {
  const [first] = rows;
  const places = new Set(rows.map(folderOf));
  const [place] = places;
  const where = places.size === 1 && place ? ` in ${place}` : " where they were";
  const bin = trashed === 0 ? "The Recycle Bin" : "It";
  const refused =
    rows.length === 1 && first
      ? `${bin} would not take ${first.name}, so it stays${place ? ` in ${place}` : " where it was"}.`
      : `${bin} would not take ${files(rows.length)}, so they stay${where}.`;
  if (trashed === 0) return refused;
  return `Moved ${formatCount(trashed)} of ${files(trashed + rows.length + asked)} to the Recycle Bin. ${refused}`;
}

/** Drives with no Recycle Bin, as a question's head names them: one or two by name, more counted. */
export function noBinDrives(drives: readonly string[]) {
  const [one, two] = drives;
  if (drives.length === 1) return `${one} has no Recycle Bin`;
  if (drives.length === 2) return `${one} and ${two} have no Recycle Bin`;
  return `${formatCount(drives.length)} drives have no Recycle Bin`;
}

/**
 * The head of Delete's question about files on drives with no Recycle Bin: the drives, or, when
 * the rest of the selection went to the bin, how many of it are asked about.
 * Artboards › The Trash in the Recycle Bin.
 */
export function noBinHead(drives: readonly string[], asked: number, whole: number) {
  if (asked === whole) return noBinDrives(drives);
  const on = drives.length === 1 ? "a drive" : "drives";
  return `${formatCount(asked)} of ${files(whole)} ${are(asked)} on ${on} with no Recycle Bin`;
}

/** The question under the head: what goes permanently and its size, and what went to the Recycle Bin. */
export function noBinDetail(
  asked: readonly { name: string; bytes: number }[],
  whole: number,
  went: number,
) {
  const [first] = asked;
  const bytes = asked.reduce((sum, one) => sum + one.bytes, 0);
  const what =
    asked.length === 1 && first ? first.name : asked.length < whole ? "them" : files(asked.length);
  const it = asked.length === 1 ? "it" : "them";
  const question = `Permanently delete ${what}, ${formatBytes(bytes)}? Undo cannot bring ${it} back.`;
  const rest = whole - asked.length;
  if (went === 0) return question;
  const others =
    went === rest
      ? `The other ${formatCount(went)}`
      : `${formatCount(went)} of the other ${formatCount(rest)}`;
  return `${question} ${others} went to the Recycle Bin.`;
}

/** What a folder's question adds under itself when its files would go permanently. */
export function folderNoBinDetail(
  drives: readonly string[],
  asked: number,
  held: number,
  bytes: number,
) {
  const size = formatBytes(bytes);
  const its =
    asked < held ? `${formatCount(asked)} of its files` : held === 1 ? "its file" : "its files";
  const it = asked === 1 ? "it" : "them";
  return `${noBinDrives(drives)}. Deleting it permanently deletes ${its}, ${size}, and Undo cannot bring ${it} back.`;
}

/** The line at the foot after files went permanently, with nothing to undo. */
export function forGoodLine(deleted: number, drives: readonly string[], one?: string) {
  const what = one ?? files(deleted);
  const [drive] = drives;
  return drives.length === 1
    ? `Permanently deleted ${what} from ${drive}.`
    : `Permanently deleted ${what}.`;
}

/** The line at the foot when files would not go permanently: what went, then where the rest stay. */
export function forGoodKeptLine(rows: readonly Stayed[], deleted: number) {
  const [first] = rows;
  const places = new Set(rows.map(folderOf));
  const [place] = places;
  const where = places.size === 1 && place ? ` in ${place}` : " where they were";
  const kept =
    rows.length === 1 && first
      ? `${first.name} could not be deleted and stays${place ? ` in ${place}` : " where it was"}.`
      : `${files(rows.length)} could not be deleted and stay${where}.`;
  if (deleted === 0) return kept;
  return `Permanently deleted ${formatCount(deleted)} of ${files(deleted + rows.length)}. ${kept}`;
}

/** How many of a folder's gone files went permanently, when some went to the Trash instead. */
function ofThem(binned: number, outright: number) {
  if (outright === 0) return "";
  return binned === 0 ? " permanently" : `, ${formatCount(outright)} of them permanently`;
}

/** The line at the foot after a folder and its files went, some or all of them permanently. */
export const folderForGoodLine = (name: string, binned: number, outright: number) =>
  `Deleted ${name} and its ${files(binned + outright)}${ofThem(binned, outright)}.`;

/**
 * The line at the foot after a folder's files went in part, some permanently, and the folder stayed;
 * none when nothing went, since the banner says it all.
 */
export function folderKeptLine(name: string, binned: number, outright: number, whole: number) {
  const gone = binned + outright;
  if (gone === 0) return null;
  if (outright === 0) return folderStayedLine(name, binned, whole, null);
  const what =
    gone === whole
      ? `${whose(name)} ${files(whole)}`
      : `${formatCount(gone)} of ${whose(name)} ${files(whole)}`;
  return `Deleted ${what}${ofThem(binned, outright)}. ${name} is in the banner.`;
}

/**
 * The line at the foot after a folder's delete on the queue was cancelled: what went, the folder
 * staying; none when nothing went.
 */
export function folderCancelledLine(name: string, binned: number, outright: number, whole: number) {
  const gone = binned + outright;
  if (gone === 0) return null;
  const what =
    gone === whole
      ? `${whose(name)} ${files(whole)}`
      : `${formatCount(gone)} of ${whose(name)} ${files(whole)}`;
  const act =
    outright === 0
      ? `Moved ${what} to the Recycle Bin.`
      : `Deleted ${what}${ofThem(binned, outright)}.`;
  return `${act} ${name} stays.`;
}

/** The banner's sentence for a folder that stayed while its files went permanently, or would not. */
export function folderKeptBanner(name: string, binned: number, outright: number, whole: number) {
  const gone = binned + outright;
  if (gone === 0) return `${whose(name)} ${files(whole)} could not be deleted · ${name} stayed`;
  if (outright === 0) return folderStayedBanner(name, binned, whole, null);
  if (gone === whole)
    return `${name} could not go · its ${files(whole)} ${are(whole)} gone${ofThem(binned, outright)}`;
  return `${formatCount(gone)} of ${whose(name)} ${files(whole)} ${are(gone)} gone${ofThem(binned, outright)} · ${name} stayed`;
}

/** Why it may have refused, said once, since the app cannot tell which it was. */
export function binRefusedDetail(count: number) {
  const which = count === 1 ? "It" : "They";
  return `${which} may be too large for the Recycle Bin, or the Recycle Bin is turned off. Nothing was deleted.`;
}

/** What a name field says under itself when the name was refused; nothing for any other failure. */
export function refusedName(error: unknown): string | null {
  const { kind, reason } = (error ?? {}) as AppError;
  if (kind !== "refused" || !reason) return null;
  if (reason.kind !== "nameTaken") return reasonSentence(reason);
  return `${reason.place} already has a ${reason.folder ? "folder" : "file"} named ${reason.name}.`;
}

/** Why one row stayed, in the banner's Reason column: never the words the error came with. */
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
        ? `Holds ${reason.name} and ${formatCount(reason.more)} more`
        : `Holds ${reason.name}`;
    case "alreadyIn":
      return `Already in ${reason.place}`;
    case "offline":
      return `${reason.source} is offline`;
    case "sourceRemoved":
      return `${reason.source} was removed`;
    case "diskFull":
      return "The disk is full";
    case "goneFromBin":
      return "Emptied from the Recycle Bin outside Filmstrip";
    case "binRefused":
      return "The Recycle Bin would not take it";
    case "noBin":
      return `${reason.drive} has no Recycle Bin`;
    case "pathTooLong":
      return "Path too long for the Recycle Bin";
    case "noHardLinks":
      return `${reason.drive} has no hard links`;
    case "busy":
      return "The index is busy";
    case "notIndexed":
      return "No longer in the index";
    case "unsupported":
      return "Unsupported format";
    case "unreadable":
      return "Could not be read";
    case "noFfmpeg":
      return "ffmpeg not found";
    case "forbiddenCharacter":
      return `A name cannot contain ${character(reason.character)}`;
    case "nameClash":
      return `${reason.first} and ${reason.second} are one name in ${reason.path.join(" › ")}`;
    case "other":
      return "Something went wrong";
  }
}

/** A character Windows refuses in a name, quoted, or said in words when it cannot be seen. */
const character = (one: string) => (/\p{Cc}/u.test(one) ? "a control character" : `“${one}”`);

/** The one file's name when it is known, else how many: what a failed act's wording takes. */
export function nameOrCount(items: readonly { id: number; diskName?: string }[]): string | number {
  const [first] = items;
  return items.length === 1 && first?.diskName ? first.diskName : items.length;
}

const said = (what: string | number) => (typeof what === "number" ? files(what) : what);

/** What an act that failed says before why: what it could not do, to what. */
export const shownFailed = (name: string) => `Could not show ${name} in Explorer.`;
export const openFailed = (name: string) => `Could not open ${name}.`;
export const copiedFailed = (what: string | number) => `Could not copy ${said(what)}.`;
export const pathsFailed = (what: string | number) =>
  typeof what === "string" || what === 1
    ? `Could not copy the path of ${said(what)}.`
    : `Could not copy the paths of ${said(what)}.`;

export const movedFailed = (count: number, to: string) =>
  `Could not move ${files(count)} to ${to}.`;
export const deletedFailed = (count: number) => `Could not delete ${files(count)}.`;
export const restoredFailed = (count: number, to: string | null) =>
  to ? `Could not restore ${files(count)} to ${to}.` : `Could not restore ${files(count)}.`;

/** What a favourite that failed says, before why: `what` is a name, or files counted when unnamed. */
export function favouriteFailed(what: string | number, was: boolean) {
  return was
    ? `Could not remove ${said(what)} from favourites.`
    : `Could not favourite ${said(what)}.`;
}

/** Why, as the sentence after the one that says what failed. */
export function reasonSentence(reason: Reason): string {
  switch (reason.kind) {
    case "busy":
      return "The index is busy. Try again in a moment.";
    case "permissionDenied":
      return "Windows refused access.";
    default:
      return `${reasonText(reason)}.`;
  }
}

/** Why anything failed, as the sentence after the one that says so: never the error's own text. */
export function whyFailed(error: unknown): string {
  const failed = error as Partial<AppError> | null;
  return reasonSentence(failed?.reason ?? { kind: "other" });
}

/**
 * What the foot says when an undo failed, its Undo kept to try again: the act by its line's one
 * sentence, when the act could be read.
 */
export function undoFailedLine(batch: Batch | null, error: unknown): string {
  if (!batch) return `Could not undo. ${whyFailed(error)}`;
  const { act } = batch;
  const line =
    act.kind === "deleteFolder" && act.into && batch.files > 0
      ? `Deleted ${act.name}`
      : actLine(batch).replace(/\.$/, "");
  return `Could not undo “${line}”. ${whyFailed(error)}`;
}

/**
 * The line after a redo a newer act stopped before its end: what went, counted against what the
 * redo held, then that it stopped.
 */
export function redoStoppedLine({ batch, filesBack, foldersBack }: UndoReport): string {
  const { act, files: whole } = batch;
  const stop = "A newer act stopped the redo.";
  const part = `${formatCount(filesBack)} of ${files(whole)}`;
  switch (act.kind) {
    case "move":
      return `Moved ${part} to ${act.to}. ${stop}`;
    case "delete":
      return `Moved ${part} to the Recycle Bin. ${stop}`;
    case "restore":
      return `Restored ${part}${act.to ? ` to ${act.to}` : ""}. ${stop}`;
    case "copy":
      if (filesBack > 0) return `Copied ${part} to ${act.to}. ${stop}`;
      if (act.folder && whole > 0)
        return `Copied ${act.folder} to ${act.to} but none of its ${files(whole)}. ${stop}`;
      return `Copied ${formatCount(foldersBack)} of ${folders(batch.folders)} to ${act.to}. ${stop}`;
    default:
      return `Redid part of “${actLine(batch).replace(/\.$/, "")}”. ${stop}`;
  }
}

/** What the foot says when a redo failed, its Redo kept to try again, as an undo's failure is. */
export function redoFailedLine(batch: Batch | null, error: unknown): string {
  if (!batch) return `Could not redo. ${whyFailed(error)}`;
  return `Could not redo “${actLine(batch).replace(/\.$/, "")}”. ${whyFailed(error)}`;
}

/**
 * A row its undo let go of, the file gone from the bin or the index, its way back in a removed
 * source, or its way to the bin on a drive with none: nothing is left to retry.
 */
export function letGo(row: Stayed) {
  return (
    row.at.kind === "recycleBin" ||
    row.at.kind === "forgotten" ||
    row.reason.kind === "sourceRemoved" ||
    row.reason.kind === "noBin"
  );
}

const goneFrom = (one: Stayed) => one.at.kind === "forgotten" || one.reason.kind === "notOnDisk";

export type StayedGroup = { heading: string; rows: Stayed[] };

/**
 * The rows under the place each is still in, one heading per place. Places are named from the
 * nearest folder they share, so "Trips" and "Trips › Cairo" read as where they are. What an export
 * `skipped` is placed from its source, since an export reaches across the library.
 */
export function stayedGroups(stayed: readonly Stayed[], skipped = false): StayedGroup[] {
  const still = skipped ? "Skipped in" : "Still in";
  const keyOf = (one: Stayed) =>
    one.at.kind === "trash" || one.at.kind === "recycleBin"
      ? one.at.kind
      : one.at.kind === "outside"
        ? `outside:${one.at.dir.toLowerCase()}`
        : `${goneFrom(one)}:${one.at.path.join("/")}`;
  const groups = new Map<string, Stayed[]>();
  for (const one of stayed) groups.set(keyOf(one), [...(groups.get(keyOf(one)) ?? []), one]);

  const paths = [...groups.values()].flatMap(([first]) =>
    first && (first.at.kind === "folder" || first.at.kind === "forgotten") ? [first.at.path] : [],
  );
  const shared = sharedDepth(paths);
  return [...groups.values()]
    .map((rows) => {
      const [first] = rows;
      if (!first || first.at.kind === "trash")
        return { heading: "Still in the Trash", rows, depth: 0 };
      if (first.at.kind === "recycleBin")
        return { heading: "Gone from the Recycle Bin", rows, depth: Number.MAX_SAFE_INTEGER };
      // Outside the library a directory goes by its own name, as Explorer's title bar has it.
      if (first.at.kind === "outside")
        return { heading: `${still} ${dirName(first.at.dir)}`, rows, depth: 0 };
      const path = first.at.path;
      const from = skipped ? 0 : Math.max(Math.min(shared, path.length) - 1, 0);
      const place = path.slice(from).join(" › ");
      return {
        heading: `${goneFrom(first) ? "Gone from" : still} ${place}`,
        rows,
        depth: path.length,
      };
    })
    .sort((a, b) => a.depth - b.depth)
    .map(({ heading, rows }) => ({ heading, rows }));
}

/** A directory's last name: `Downloads` for `C:\Users\Ana\Downloads`, or the drive for a root. */
export function dirName(dir: string) {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? dir;
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

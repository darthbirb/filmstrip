import { expect, test } from "vitest";

import type { Act } from "../../ipc/bindings/Act";
import type { Reason } from "../../ipc/bindings/Reason";
import type { Stayed } from "../../ipc/bindings/Stayed";
import type { UndoReport } from "../../ipc/bindings/UndoReport";
import {
  actLine,
  binRefusedDetail,
  binRefusedLine,
  copiedBannerLine,
  copiedFailed,
  copyCancelledLine,
  deletedBannerLine,
  favouriteFailed,
  folderForGoodLine,
  folderKeptBanner,
  folderKeptLine,
  folderNoBinDetail,
  folderStayedBanner,
  folderStayedLine,
  forGoodKeptLine,
  forGoodLine,
  holdsLine,
  letGo,
  movedBannerLine,
  movedFailed,
  noBinDetail,
  noBinHead,
  pathsFailed,
  reasonSentence,
  reasonText,
  redoBannerLine,
  redoFailedLine,
  refusedName,
  restoredBannerLine,
  restoredFailed,
  shownFailed,
  stayedGroups,
  undoBannerLine,
  undoFailedLine,
  undoneLine,
  whyFailed,
} from "./lines";

const batch = (act: Act, files = 0, folders = 0) => ({ batchId: "b", act, files, folders });
const undone = (act: Act, files: number, filesBack = files, stayed: Stayed[] = []): UndoReport => ({
  batch: batch(act, files),
  filesBack,
  foldersBack: 0,
  stayed,
});

const MOVE: Act = { kind: "move", from: "Trips", to: "Cairo", one: null };
const DELETE: Act = { kind: "delete", from: "Cairo", one: null };
const RENAME: Act = { kind: "renameFolder", from: "Lisbon", to: "Lisboa" };
const CREATE: Act = { kind: "createFolder", name: "Egypt", parent: "Trips" };
const MOVED_FOLDER: Act = { kind: "moveFolder", name: "Lisbon", from: "Trips", to: "Archive" };
const INTO_INBOX: Act = { kind: "deleteFolder", name: "Lisbon", parent: "Trips", into: "Inbox" };
const TO_TRASH: Act = { kind: "deleteFolder", name: "Lisbon", parent: "Trips", into: null };
const EMPTY: Act = { kind: "deleteFolder", name: "Egypt", parent: "Trips", into: null };
const ADD_TAG: Act = { kind: "addTag", tag: "upper east side" };
const REMOVE_TAG: Act = { kind: "removeTag", tag: "felucca" };

test("each act's line, and the line after undoing it, read as Artboards › Undo's table does", () => {
  const rows: [Act, number, string, string][] = [
    [MOVE, 3, "Moved 3 files to Cairo.", "3 files are back in Trips."],
    [DELETE, 5, "Moved 5 files to the Recycle Bin.", "5 files are back in Cairo."],
    [RENAME, 0, "Renamed Lisbon to Lisboa.", "Lisboa is Lisbon again."],
    [CREATE, 0, "Created Egypt in Trips.", "Egypt is gone from Trips."],
    [
      INTO_INBOX,
      214,
      "Deleted Lisbon. Its 214 files are in Inbox.",
      "Lisbon and its 214 files are back in Trips.",
    ],
    [MOVED_FOLDER, 0, "Moved Lisbon to Archive.", "Lisbon is back in Trips."],
    [
      TO_TRASH,
      214,
      "Deleted Lisbon and its 214 files.",
      "Lisbon and its 214 files are back in Trips.",
    ],
    [EMPTY, 0, "Deleted Egypt.", "Egypt is back in Trips."],
    [ADD_TAG, 5, "Added upper east side to 5 files.", "Removed upper east side from 5 files."],
    [REMOVE_TAG, 3120, "Took felucca off 3,120 files.", "felucca is back on 3,120 files."],
  ];
  for (const [act, files, after, back] of rows) {
    expect(actLine(batch(act, files))).toBe(after);
    expect(undoneLine(undone(act, files))).toBe(back);
  }
});

test("an act that finished in part says so, and one file is named rather than counted", () => {
  expect(actLine(batch(MOVE, 3), 2)).toBe(
    "Moved 3 of 5 files to Cairo. The other 2 are in the banner.",
  );
  expect(actLine(batch(DELETE, 3), 2)).toBe(
    "Moved 3 of 5 files to the Recycle Bin. The other 2 are in the banner.",
  );
  const one: Act = { kind: "move", from: "Trips", to: "Cairo", one: "pyramid.jpg" };
  expect(actLine(batch(one, 1))).toBe("Moved pyramid.jpg to Cairo.");
  expect(undoneLine(undone(one, 1))).toBe("pyramid.jpg is back in Trips.");
  const scattered: Act = { kind: "move", from: null, to: "Cairo", one: null };
  expect(undoneLine(undone(scattered, 4))).toBe("4 files are back where they were.");
});

test("an undo that came back in part is counted, and one where none did is turned round", () => {
  expect(undoBannerLine(undone(MOVE, 5, 3))).toBe("3 of 5 files are back in Trips");
  expect(undoBannerLine(undone(MOVE, 3, 0))).toBe("The 3 files could not go back to Trips");
  expect(undoBannerLine(undone(RENAME, 0, 0))).toBe("Lisboa could not be Lisbon again");
  expect(undoBannerLine(undone(INTO_INBOX, 214, 211))).toBe(
    "Lisbon and 211 of its 214 files are back in Trips",
  );
  const scattered: Act = { kind: "delete", from: null, one: null };
  expect(undoBannerLine(undone(scattered, 4, 2))).toBe("2 of 4 files are back where they were");
});

test("a verb's own banner counts what went, or says none did", () => {
  expect(movedBannerLine(3, 5, "Cairo")).toBe("3 of 5 files moved to Cairo");
  expect(deletedBannerLine(3, 5)).toBe("3 of 5 files went to the Recycle Bin");
  expect(deletedBannerLine(0, 5)).toBe("The 5 files could not go to the Recycle Bin");
  expect(deletedBannerLine(0, 1, "IMG_0031.jpg")).toBe(
    "IMG_0031.jpg could not go to the Recycle Bin",
  );
});

test("each reason is said in the banner's own words", () => {
  expect(reasonText({ kind: "nameTaken", place: "Trips", name: "a.jpg", folder: false })).toBe(
    "Name taken in Trips",
  );
  expect(reasonText({ kind: "folderGone", name: "Egypt" })).toBe("Egypt is gone");
  expect(reasonText({ kind: "inUse" })).toBe("Open in another app");
  expect(reasonText({ kind: "permissionDenied" })).toBe("Permission denied");
  expect(reasonText({ kind: "notOnDisk", name: "a.jpg" })).toBe("No longer on disk");
  expect(reasonText({ kind: "holds", name: "notes.txt", more: 0 })).toBe("Holds notes.txt");
  expect(reasonText({ kind: "holds", name: "notes.txt", more: 1 })).toBe(
    "Holds notes.txt and 1 more",
  );
  expect(reasonText({ kind: "holds", name: "notes.txt", more: 1204 })).toBe(
    `Holds notes.txt and ${(1204).toLocaleString()} more`,
  );
  expect(reasonText({ kind: "goneFromBin", name: "a.jpg", place: "Cairo" })).toBe(
    "Emptied from the Recycle Bin outside Filmstrip",
  );
  expect(reasonText({ kind: "binRefused" })).toBe("The Recycle Bin would not take it");
  expect(reasonText({ kind: "pathTooLong" })).toBe("Path too long for the Recycle Bin");
  expect(reasonText({ kind: "noHardLinks", drive: "Photos (F:)" })).toBe(
    "Photos (F:) has no hard links",
  );
  expect(reasonText({ kind: "sourceRemoved", source: "Phone" })).toBe("Phone was removed");
  expect(reasonText({ kind: "busy" })).toBe("The index is busy");
  expect(reasonText({ kind: "notIndexed" })).toBe("No longer in the index");
  expect(reasonText({ kind: "unsupported" })).toBe("Unsupported format");
  expect(reasonText({ kind: "unreadable" })).toBe("Could not be read");
  expect(reasonText({ kind: "noFfmpeg" })).toBe("ffmpeg not found");
  expect(reasonText({ kind: "other" })).toBe("Something went wrong");
});

/** One of every reason, so a new one fails to compile here until it is worded. */
const EVERY: { [K in Reason["kind"]]: Extract<Reason, { kind: K }> } = {
  nameTaken: { kind: "nameTaken", place: "Trips", name: "a.jpg", folder: false },
  folderGone: { kind: "folderGone", name: "Egypt" },
  inUse: { kind: "inUse" },
  permissionDenied: { kind: "permissionDenied" },
  notOnDisk: { kind: "notOnDisk", name: "a.jpg" },
  holds: { kind: "holds", name: "notes.txt", more: 2 },
  alreadyIn: { kind: "alreadyIn", place: "Cairo" },
  offline: { kind: "offline", source: "Phone" },
  sourceRemoved: { kind: "sourceRemoved", source: "Phone" },
  diskFull: { kind: "diskFull" },
  goneFromBin: { kind: "goneFromBin", name: "a.jpg", place: "Cairo" },
  binRefused: { kind: "binRefused" },
  noBin: { kind: "noBin", drive: "USB Drive (E:)" },
  pathTooLong: { kind: "pathTooLong" },
  noHardLinks: { kind: "noHardLinks", drive: "Photos (F:)" },
  busy: { kind: "busy" },
  notIndexed: { kind: "notIndexed" },
  unsupported: { kind: "unsupported" },
  unreadable: { kind: "unreadable" },
  noFfmpeg: { kind: "noFfmpeg" },
  forbiddenCharacter: { kind: "forbiddenCharacter", character: ":" },
  other: { kind: "other" },
};

test("every reason is worded as a phrase and as a sentence with one full stop", () => {
  for (const reason of Object.values(EVERY)) {
    const phrase = reasonText(reason);
    const sentence = reasonSentence(reason);
    expect(phrase, reason.kind).toMatch(/^\S.*[^.\s]$/);
    expect(sentence, reason.kind).toMatch(/[^.]\.$/);
  }
  expect(reasonSentence(EVERY.busy)).toBe("The index is busy. Try again in a moment.");
  expect(reasonSentence(EVERY.permissionDenied)).toBe("Windows refused access.");
  expect(reasonSentence(EVERY.diskFull)).toBe("The disk is full.");
  expect(reasonSentence(EVERY.other)).toBe("Something went wrong.");
});

test("what the foot says when the Recycle Bin would not take what Delete sent it", () => {
  const at = (place: string) => ({
    kind: "folder" as const,
    folderId: 1,
    path: ["Pictures", place],
  });
  const refused = (name: string, place = "Cairo"): Stayed => ({
    kind: "file",
    id: name.length,
    name,
    at: at(place),
    reason: { kind: "binRefused" },
  });
  const one = [refused("MVI_0412.mov")];
  const two = [refused("MVI_0412.mov"), refused("MVI_0415.mov")];

  expect(binRefusedLine(one)).toBe(
    "The Recycle Bin would not take MVI_0412.mov, so it stays in Cairo.",
  );
  expect(binRefusedLine(one, 4)).toBe(
    "Moved 4 of 5 files to the Recycle Bin. It would not take MVI_0412.mov, so it stays in Cairo.",
  );
  expect(binRefusedLine(one, 4, 2)).toBe(
    "Moved 4 of 7 files to the Recycle Bin. It would not take MVI_0412.mov, so it stays in Cairo.",
  );
  expect(binRefusedLine(two)).toBe(
    "The Recycle Bin would not take 2 files, so they stay in Cairo.",
  );
  expect(binRefusedLine([refused("a.mov"), refused("b.mov", "Lisbon")], 1)).toBe(
    "Moved 1 of 3 files to the Recycle Bin. It would not take 2 files, so they stay where they were.",
  );
  expect(binRefusedDetail(1)).toBe(
    "It may be too large for the Recycle Bin, or the Recycle Bin is turned off. Nothing was deleted.",
  );
  expect(binRefusedDetail(2)).toMatch(/^They may be/);
});

test("rows are grouped under the place each is still in, named from the folder they share", () => {
  const at = (path: string[]) => ({ kind: "folder" as const, folderId: path.length, path });
  const row = (name: string, path: string[] | null, reason: Stayed["reason"]): Stayed => ({
    kind: "file",
    id: name.length,
    name,
    at: path ? at(path) : { kind: "trash" },
    reason,
  });
  const inUse = { kind: "inUse" } as const;
  const groups = stayedGroups([
    row("clip_0031.mov", ["Inbox", "Day 2"], inUse),
    row("IMG_0412.jpg", ["Inbox"], inUse),
    row("IMG_0450.jpg", ["Inbox", "Day 2"], { kind: "permissionDenied" }),
  ]);
  expect(groups.map((group) => [group.heading, group.rows.map((one) => one.name)])).toEqual([
    ["Still in Inbox", ["IMG_0412.jpg"]],
    ["Still in Inbox › Day 2", ["clip_0031.mov", "IMG_0450.jpg"]],
  ]);

  const alone = stayedGroups([row("a.jpg", ["Pictures", "Trips", "Cairo"], inUse)]);
  expect(alone[0]?.heading).toBe("Still in Cairo");
  expect(stayedGroups([row("a.jpg", null, inUse)])[0]?.heading).toBe("Still in the Trash");
  const gone = stayedGroups([
    row("a.jpg", ["Pictures", "Cairo"], { kind: "notOnDisk", name: "a" }),
  ]);
  expect(gone[0]?.heading).toBe("Gone from Cairo");

  const emptied = { kind: "goneFromBin", name: "b.jpg", place: "Cairo" } as const;
  const binned: Stayed = { ...row("b.jpg", null, emptied), at: { kind: "recycleBin" } };
  const ordered = stayedGroups([binned, row("c.jpg", null, inUse), row("d.jpg", ["Inbox"], inUse)]);
  expect(ordered.map((group) => group.heading)).toEqual([
    "Still in the Trash",
    "Still in Inbox",
    "Gone from the Recycle Bin",
  ]);
});

test("a file the index forgot is gone from where it was last, and has nothing left to retry", () => {
  const row = (name: string, at: Stayed["at"], reason: Stayed["reason"]): Stayed => ({
    kind: "file",
    id: name.charCodeAt(0),
    name,
    at,
    reason,
  });
  const forgotten = (name: string, path: string[], reason: Stayed["reason"]) =>
    row(name, { kind: "forgotten", path }, reason);
  const deleted = forgotten("a.jpg", ["Pictures", "Cairo"], { kind: "notOnDisk", name: "a.jpg" });
  const removed = forgotten("b.jpg", ["Phone"], { kind: "sourceRemoved", source: "Phone" });
  const cairo: Stayed["at"] = { kind: "folder", folderId: 2, path: ["Pictures", "Cairo"] };
  const still = row("c.jpg", cairo, { kind: "inUse" });

  expect(stayedGroups([deleted, still]).map((group) => group.heading)).toEqual([
    "Gone from Cairo",
    "Still in Cairo",
  ]);
  expect(stayedGroups([removed])[0]?.heading).toBe("Gone from Phone");
  expect([deleted, removed, still].map(letGo)).toEqual([true, true, false]);
  const emptied = { kind: "goneFromBin", name: "d.jpg", place: "Cairo" } as const;
  expect(letGo(row("d.jpg", { kind: "recycleBin" }, emptied))).toBe(true);
});

test("a file whose way back was in a removed source is still where it is, with nothing to retry", () => {
  const phone: Stayed["at"] = { kind: "folder", folderId: 3, path: ["Phone"] };
  const stays: Stayed = {
    kind: "file",
    id: 5,
    name: "pyramid.jpg",
    at: phone,
    reason: { kind: "sourceRemoved", source: "Library" },
  };

  expect(stayedGroups([stays])[0]?.heading).toBe("Still in Phone");
  expect(reasonText(stays.reason)).toBe("Library was removed");
  expect(letGo(stays)).toBe(true);
});

test("a copy undone on a drive with no Recycle Bin is still where it is, with nothing to retry", () => {
  const stays: Stayed = {
    kind: "file",
    id: 7,
    name: "IMG_0412.jpg",
    at: { kind: "folder", folderId: 6, path: ["Trips", "Cairo"] },
    reason: { kind: "noBin", drive: "USB Drive (E:)" },
  };

  expect(stayedGroups([stays])[0]?.heading).toBe("Still in Cairo");
  expect(reasonText(stays.reason)).toBe("USB Drive (E:) has no Recycle Bin");
  expect(letGo(stays)).toBe(true);
});

test("a name field says where the name is taken, or why else it was refused", () => {
  const taken = { kind: "nameTaken", place: "Trips", name: "Cairo", folder: true } as const;
  expect(refusedName({ kind: "refused", reason: taken })).toBe(
    "Trips already has a folder named Cairo.",
  );
  expect(refusedName({ kind: "refused", reason: { kind: "inUse" } })).toBe("Open in another app.");
  expect(refusedName({ kind: "refused", reason: { kind: "notIndexed" } })).toBe(
    "No longer in the index.",
  );
  expect(refusedName({ kind: "invalid", reason: { kind: "other" } })).toBeNull();
});

test("a name holding a character Windows refuses is refused with the character named", () => {
  const holding = (character: string) => ({
    kind: "refused" as const,
    reason: { kind: "forbiddenCharacter" as const, character },
  });
  expect(refusedName(holding(":"))).toBe("A name cannot contain “:”.");
  expect(refusedName(holding("	"))).toBe("A name cannot contain a control character.");
});

test("an act that failed names what it could not do, the file by name or the files counted", () => {
  const one = [{ id: 1, diskName: "_DSC4411.ARW" }];
  const unnamed = [{ id: 1 }, { id: 2 }, { id: 3 }];
  expect(shownFailed("_DSC4411.ARW")).toBe("Could not show _DSC4411.ARW in Explorer.");
  expect(copiedFailed(one)).toBe("Could not copy _DSC4411.ARW.");
  expect(copiedFailed([{ id: 1 }])).toBe("Could not copy 1 file.");
  expect(pathsFailed(unnamed)).toBe("Could not copy the paths of 3 files.");
  expect(movedFailed(3, "Lisbon")).toBe("Could not move 3 files to Lisbon.");
  expect(restoredFailed(1, null)).toBe("Could not restore 1 file.");
  expect(favouriteFailed("Lisbon", false)).toBe("Could not favourite Lisbon.");
  expect(favouriteFailed(2, true)).toBe("Could not remove 2 files from favourites.");
  expect(whyFailed({ kind: "db", reason: { kind: "busy" } })).toBe(
    "The index is busy. Try again in a moment.",
  );
});

test("a folder's delete asks, and says what went when the folder stayed, as the table words it", () => {
  expect(holdsLine("Lisbon", 214)).toBe("Lisbon holds 214 files");
  expect(folderStayedLine("Lisbon", 211, 214, "Inbox")).toBe(
    "Moved 211 of Lisbon’s 214 files to Inbox. Lisbon is in the banner.",
  );
  expect(folderStayedLine("Trips", 5, 5, null)).toBe(
    "Moved Trips’ 5 files to the Recycle Bin. Trips is in the banner.",
  );
  expect(folderStayedBanner("Lisbon", 214, 214, "Inbox")).toBe(
    "Lisbon could not go · its 214 files are in Inbox",
  );
  expect(folderStayedBanner("Lisbon", 211, 214, "Inbox")).toBe(
    "211 of Lisbon’s 214 files are in Inbox · Lisbon stayed",
  );
  expect(folderStayedBanner("Lisbon", 211, 214, null)).toBe(
    "211 of Lisbon’s 214 files are in the Trash · Lisbon stayed",
  );
  expect(folderStayedBanner("Egypt", 0, 0, null)).toBe("Egypt could not go");
});

test("Restore's line, its undo, and its refusal read as Artboards › Trash words them", () => {
  const one: Act = { kind: "restore", to: "Cairo", one: "IMG_0031.jpg" };
  expect(actLine(batch(one, 1))).toBe("Restored IMG_0031.jpg to Cairo.");
  expect(undoneLine(undone(one, 1))).toBe("IMG_0031.jpg is back in the Trash.");
  const scattered: Act = { kind: "restore", to: null, one: null };
  expect(actLine(batch(scattered, 2), 2)).toBe(
    "Restored 2 of 4 files. The other 2 are in the banner.",
  );
  expect(restoredBannerLine(0, 1, "Egypt", true, "IMG_0052.jpg")).toBe(
    "IMG_0052.jpg could not go back to Egypt",
  );
  expect(restoredBannerLine(2, 4, null, true)).toBe("2 of 4 files are back where they were");
  expect(restoredBannerLine(2, 4, "Cairo", true)).toBe("2 of 4 files are back in Cairo");
  expect(restoredBannerLine(0, 1, "People", false, "a.jpg")).toBe("a.jpg could not go to People");
});

test("an act on the tags screen says what it touched, and undoing it puts the term back", () => {
  const retag = (change: Extract<Act, { kind: "retag" }>["change"]): Act => ({
    kind: "retag",
    change,
  });
  const rows: [Act, number, number, string, string][] = [
    [
      retag({ kind: "mergeTags", from: "dawn", into: "golden hour" }),
      38,
      2,
      "Merged the tag dawn into golden hour on 38 files and 2 folders.",
      "The tag dawn is back on 38 files and 2 folders.",
    ],
    [
      retag({ kind: "renameTag", from: "dawn", to: "first light" }),
      38,
      0,
      "Renamed the tag dawn to first light on 38 files.",
      "The tag first light is dawn again.",
    ],
    [
      retag({ kind: "deleteTag", tag: "winter" }),
      0,
      0,
      "Deleted the tag winter.",
      "The tag winter is back.",
    ],
    [
      retag({ kind: "deleteKey", key: "place" }),
      640,
      2,
      "Deleted the label key place from 640 files and 2 folders.",
      "The label key place is back on 640 files and 2 folders.",
    ],
    [
      retag({ kind: "mergeValues", key: "trip", from: "nile 2019", into: "egypt 2024" }),
      310,
      1,
      "Merged the label trip: nile 2019 into trip: egypt 2024 on 310 files and 1 folder.",
      "The label trip: nile 2019 is back on 310 files and 1 folder.",
    ],
    [
      retag({ kind: "renameValue", key: "trip", from: "nile 2019", to: "nile 2020" }),
      310,
      1,
      "Renamed the label trip: nile 2019 to trip: nile 2020 on 310 files and 1 folder.",
      "The label trip: nile 2020 is trip: nile 2019 again.",
    ],
  ];
  for (const [act, files, folders, line, back] of rows) {
    const done = batch(act, files, folders);
    expect(actLine(done)).toBe(line);
    expect(undoneLine({ batch: done, filesBack: files, foldersBack: folders, stayed: [] })).toBe(
      back,
    );
  }
});

test("a label key's lines name it as a label key, never a key alone", () => {
  const renamed: Act = { kind: "retag", change: { kind: "renameKey", from: "place", to: "where" } };
  expect(actLine(batch(renamed, 12, 0))).toBe("Renamed the label key place to where on 12 files.");
  expect(undoneLine(undone(renamed, 12))).toBe("The label key where is place again.");
  const merged: Act = {
    kind: "retag",
    change: { kind: "mergeKeys", from: "place", into: "where" },
  };
  expect(actLine(batch(merged, 0, 0))).toBe("Merged the label key place into where.");
  expect(undoBannerLine(undone(merged, 0, 0))).toBe("The label key place could not come back");
});

test("a copy's lines read as Artboards › Bringing files in has them", () => {
  const files: Act = { kind: "copy", to: "Lisbon", one: null, folder: null, folders: 0 };
  const lone: Act = { kind: "copy", to: "Lisbon", one: "IMG_5001.jpg", folder: null, folders: 0 };
  const tree: Act = { kind: "copy", to: "Lisbon", one: null, folder: "Alexandria", folders: 1 };
  const mix: Act = { kind: "copy", to: "Lisbon", one: null, folder: null, folders: 2 };
  expect(actLine(batch(files, 3))).toBe("Copied 3 files to Lisbon.");
  expect(actLine(batch(lone, 1))).toBe("Copied IMG_5001.jpg to Lisbon.");
  expect(actLine(batch(tree, 214, 3))).toBe("Copied Alexandria and its 214 files to Lisbon.");
  expect(actLine(batch(mix, 219, 4))).toBe("Copied 219 files and 2 folders to Lisbon.");
  expect(actLine(batch(files, 117), 3)).toBe(
    "Copied 117 of 120 files to Lisbon. The other 3 are in the banner.",
  );
  expect(copyCancelledLine(batch(files, 412), 1200)).toBe("Copied 412 of 1,200 files to Lisbon.");
  expect(copiedBannerLine(117, 120, "Lisbon")).toBe("117 of 120 files came into Lisbon");
  expect(copiedBannerLine(0, 214, "Lisbon", "Alexandria")).toBe(
    "Alexandria could not come into Lisbon",
  );
  expect(undoneLine(undone(files, 3))).toBe("3 files left Lisbon for the Trash.");
  expect(undoBannerLine(undone(files, 3, 2))).toBe("2 of 3 files left Lisbon for the Trash");
  expect(reasonText({ kind: "alreadyIn", place: "Cairo" })).toBe("Already in Cairo");
});

test("what a copy left outside the library is grouped under the directory it is still in", () => {
  const outside = (name: string, dir: string): Stayed => ({
    kind: "file",
    id: 0,
    name,
    at: { kind: "outside", dir, into: 1 },
    reason: { kind: "inUse" },
  });
  const groups = stayedGroups([
    outside("IMG_5004.jpg", "C:\\Users\\Ana\\Downloads"),
    outside("IMG_5017.jpg", "C:\\Users\\Ana\\downloads"),
    outside("clip.mov", "E:\\DCIM\\100CANON"),
  ]);
  expect(groups.map((group) => [group.heading, group.rows.length])).toEqual([
    ["Still in Downloads", 2],
    ["Still in 100CANON", 1],
  ]);
});

test("a drive with no Recycle Bin is named, two are, three or more are counted", () => {
  expect(noBinHead(["USB Drive (E:)"], 1, 1)).toBe("USB Drive (E:) has no Recycle Bin");
  expect(noBinHead(["USB Drive (E:)", "SD Card (F:)"], 4, 4)).toBe(
    "USB Drive (E:) and SD Card (F:) have no Recycle Bin",
  );
  expect(noBinHead(["E", "F", "G"], 3, 3)).toBe("3 drives have no Recycle Bin");
  expect(noBinHead(["USB Drive (E:)"], 3, 15)).toBe(
    "3 of 15 files are on a drive with no Recycle Bin",
  );
  expect(noBinHead(["E", "F"], 1, 15)).toBe("1 of 15 files is on drives with no Recycle Bin");
  expect(reasonText({ kind: "noBin", drive: "USB Drive (E:)" })).toBe(
    "USB Drive (E:) has no Recycle Bin",
  );
});

test("the question says what goes permanently, its size, and what went to the Recycle Bin", () => {
  const mb = 1024 * 1024;
  const file = (name: string, bytes: number) => ({ name, bytes });
  expect(noBinDetail([file("MVI_0412.mov", 12 * mb)], 1, 0)).toBe(
    "Permanently delete MVI_0412.mov, 12 MB? Undo cannot bring it back.",
  );
  const three = [file("a.jpg", mb), file("b.jpg", mb), file("c.jpg", 2 * mb)];
  expect(noBinDetail(three, 3, 0)).toBe(
    "Permanently delete 3 files, 4 MB? Undo cannot bring them back.",
  );
  expect(noBinDetail(three, 15, 12)).toBe(
    "Permanently delete them, 4 MB? Undo cannot bring them back. The other 12 went to the Recycle Bin.",
  );
  expect(noBinDetail(three, 15, 10)).toBe(
    "Permanently delete them, 4 MB? Undo cannot bring them back. 10 of the other 12 went to the Recycle Bin.",
  );
  expect(folderNoBinDetail(["USB Drive (E:)"], 214, 214, 3 * mb)).toBe(
    "USB Drive (E:) has no Recycle Bin. Deleting it permanently deletes its files, 3 MB, and Undo cannot bring them back.",
  );
  expect(folderNoBinDetail(["USB Drive (E:)"], 2, 5, mb)).toBe(
    "USB Drive (E:) has no Recycle Bin. Deleting it permanently deletes 2 of its files, 1 MB, and Undo cannot bring them back.",
  );
  expect(folderNoBinDetail(["USB Drive (E:)"], 1, 5, mb)).toBe(
    "USB Drive (E:) has no Recycle Bin. Deleting it permanently deletes 1 of its files, 1 MB, and Undo cannot bring it back.",
  );
});

test("what went permanently is said with no Undo, and what would not go is named", () => {
  const kept = (name: string, place = "Lisbon"): Stayed => ({
    kind: "file",
    id: name.length,
    name,
    at: { kind: "folder", folderId: 1, path: ["Pictures", place] },
    reason: { kind: "inUse" },
  });
  expect(forGoodLine(3, ["USB Drive (E:)"])).toBe(
    "Permanently deleted 3 files from USB Drive (E:).",
  );
  expect(forGoodLine(1, ["USB Drive (E:)"], "a.jpg")).toBe(
    "Permanently deleted a.jpg from USB Drive (E:).",
  );
  expect(forGoodLine(5, ["E", "F"])).toBe("Permanently deleted 5 files.");
  expect(forGoodKeptLine([kept("DSC_0102.jpg")], 2)).toBe(
    "Permanently deleted 2 of 3 files. DSC_0102.jpg could not be deleted and stays in Lisbon.",
  );
  expect(forGoodKeptLine([kept("a.jpg"), kept("b.jpg", "Porto")], 0)).toBe(
    "2 files could not be deleted and stay where they were.",
  );
  expect(folderForGoodLine("Lisbon", 0, 214)).toBe("Deleted Lisbon and its 214 files permanently.");
  expect(folderForGoodLine("Trips", 1, 2)).toBe(
    "Deleted Trips and its 3 files, 2 of them permanently.",
  );
  expect(folderForGoodLine("Trips", 3, 0)).toBe("Deleted Trips and its 3 files.");
  expect(folderKeptLine("Lisbon", 0, 213, 214)).toBe(
    "Deleted 213 of Lisbon’s 214 files permanently. Lisbon is in the banner.",
  );
  expect(folderKeptLine("Trips", 1, 2, 4)).toBe(
    "Deleted 3 of Trips’ 4 files, 2 of them permanently. Trips is in the banner.",
  );
  expect(folderKeptLine("Trips", 1, 0, 4)).toBe(
    "Moved 1 of Trips’ 4 files to the Recycle Bin. Trips is in the banner.",
  );
  expect(folderKeptLine("Lisbon", 0, 0, 1)).toBeNull();
  expect(folderKeptBanner("Lisbon", 0, 213, 214)).toBe(
    "213 of Lisbon’s 214 files are gone permanently · Lisbon stayed",
  );
  expect(folderKeptBanner("Trips", 1, 2, 3)).toBe(
    "Trips could not go · its 3 files are gone, 2 of them permanently",
  );
  expect(folderKeptBanner("Lisbon", 0, 0, 214)).toBe(
    "Lisbon’s 214 files could not be deleted · Lisbon stayed",
  );
  expect(folderKeptBanner("Lisbon", 0, 214, 214)).toBe(
    "Lisbon could not go · its 214 files are gone permanently",
  );
});

test("a failed undo names its act in one sentence, or says only why when the act could not be read", () => {
  const full = { kind: "io", reason: { kind: "diskFull" } };
  expect(undoFailedLine(batch(MOVE, 3), full)).toBe(
    "Could not undo “Moved 3 files to Cairo”. The disk is full.",
  );
  expect(undoFailedLine(batch(INTO_INBOX, 4), full)).toBe(
    "Could not undo “Deleted Lisbon”. The disk is full.",
  );
  expect(undoFailedLine(batch(TO_TRASH, 4), new Error("database is locked"))).toBe(
    "Could not undo “Deleted Lisbon and its 4 files”. Something went wrong.",
  );
  expect(undoFailedLine(null, full)).toBe("Could not undo. The disk is full.");
});

test("a redo that went in part is counted as its act's banner counts it, or turned round", () => {
  expect(redoBannerLine(undone(MOVE, 5, 3))).toBe("3 of 5 files moved to Cairo");
  expect(redoBannerLine(undone(MOVE, 3, 0))).toBe("The 3 files could not go to Cairo");
  expect(redoBannerLine(undone(DELETE, 4, 1))).toBe("1 of 4 files went to the Recycle Bin");
  expect(redoBannerLine(undone(RENAME, 0, 0))).toBe("Lisbon could not be Lisboa again");
  expect(redoBannerLine(undone(CREATE, 0, 0))).toBe("Egypt could not come back to Trips");
  expect(redoBannerLine(undone(MOVED_FOLDER, 0, 0))).toBe("Lisbon could not go to Archive");
  const folder: Stayed = {
    kind: "folder",
    id: 9,
    name: "Lisbon",
    at: { kind: "folder", folderId: 4, path: ["Library", "Trips"] },
    reason: { kind: "holds", name: "tram.jpg", more: 0 },
  };
  expect(redoBannerLine(undone(TO_TRASH, 3, 2, [folder]))).toBe(
    "2 of Lisbon’s 3 files are in the Trash · Lisbon stayed",
  );
});

test("a failed redo names its act in one sentence, or says only why when the act could not be read", () => {
  const full = { kind: "io", reason: { kind: "diskFull" } };
  expect(redoFailedLine(batch(MOVE, 3), full)).toBe(
    "Could not redo “Moved 3 files to Cairo”. The disk is full.",
  );
  expect(redoFailedLine(null, full)).toBe("Could not redo. The disk is full.");
});

import { expect, test } from "vitest";

import type { Act } from "../../ipc/bindings/Act";
import type { Stayed } from "../../ipc/bindings/Stayed";
import type { UndoReport } from "../../ipc/bindings/UndoReport";
import {
  actLine,
  deletedBannerLine,
  movedBannerLine,
  reasonText,
  stayedGroups,
  undoBannerLine,
  undoneLine,
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

test("each act's line, and the line after undoing it, read as Artboards › Undo's table does", () => {
  const rows: [Act, number, string, string][] = [
    [MOVE, 3, "Moved 3 files to Cairo.", "3 files are back in Trips."],
    [DELETE, 5, "Deleted 5 files.", "5 files are back in Cairo."],
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
  expect(actLine(batch(DELETE, 3), 2)).toBe("Deleted 3 of 5 files. The other 2 are in the banner.");
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
  expect(deletedBannerLine(3, 5)).toBe("3 of 5 files went to the Trash");
  expect(deletedBannerLine(0, 5)).toBe("The 5 files could not go to the Trash");
  expect(deletedBannerLine(0, 1, "IMG_0031.jpg")).toBe("IMG_0031.jpg could not go to the Trash");
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
});

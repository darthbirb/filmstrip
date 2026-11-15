import { expect, test } from "vitest";

import { formatTime } from "../../lib/format";
import {
  dueLine,
  emptiedLine,
  emptyingLine,
  emptyQuestion,
  expiredLine,
  expiredReason,
  heldLine,
  keptLine,
  refusedLine,
  USUAL,
} from "./expiry-words";

const GB = 2 ** 30;
const tally = (count: number, gb: number) => ({ count, bytes: gb * GB });
const none = tally(0, 0);
const AT = 1_731_600_000;
const text = (said: ReturnType<typeof dueLine>) =>
  said.map((part) => (typeof part === "string" ? part : part.term)).join("");

test("the head says what the Trash holds, against its total when it has one", () => {
  expect(heldLine(tally(312, 8.4), 25)).toBe("312 files · 8.4 GB of 25 GB");
  expect(heldLine(tally(1, 2), null)).toBe("1 file · 2 GB");
  expect(heldLine(none, 25)).toBe("Nothing in it");
});

test("the line under the limits says what the next run sends, by which limit, and when", () => {
  const when = formatTime(AT);
  expect(dueLine({ byAge: none, bySize: none }, 30, 25, AT)).toEqual([USUAL]);
  expect(text(dueLine({ byAge: tally(12, 1.2), bySize: none }, 30, 25, AT))).toBe(
    `12 files, 1.2 GB, deleted over 30 days ago, go to the Recycle Bin at ${when}.`,
  );
  expect(text(dueLine({ byAge: none, bySize: tally(1, 3) }, 30, 25, AT))).toBe(
    `1 file, 3 GB, the oldest, goes to the Recycle Bin at ${when} to keep the Trash under 25 GB.`,
  );
  const both = dueLine({ byAge: tally(2, 1), bySize: tally(3, 3) }, 365, 10, AT);
  expect(text(both)).toBe(
    `5 files, 4 GB, go to the Recycle Bin at ${when}: 2 deleted over 1 year ago, 3 to keep the Trash under 10 GB.`,
  );
  expect(both.filter((part) => typeof part !== "string")).toEqual([
    { term: "5 files" },
    { term: when },
  ]);
});

test("a run says at the foot what went to the Recycle Bin, and why", () => {
  const ran = {
    keepDays: 30,
    totalBytes: 25 * GB,
    refused: 0,
    firstRefused: null,
    refusedGrew: false,
  };
  expect(expiredLine({ ...ran, byAge: 12, bySize: 0 })).toBe(
    "12 files went to the Recycle Bin, 30 days after they were deleted.",
  );
  expect(expiredLine({ ...ran, byAge: 1, bySize: 0 })).toBe(
    "1 file went to the Recycle Bin, 30 days after it was deleted.",
  );
  expect(expiredLine({ ...ran, byAge: 0, bySize: 4 })).toBe(
    "4 files went to the Recycle Bin, oldest first, to keep the Trash under 25 GB.",
  );
  expect(expiredLine({ ...ran, byAge: 2, bySize: 3 })).toBe(
    "5 files went to the Recycle Bin: 2 past 30 days, 3 to keep the Trash under 25 GB.",
  );
});

test("what the Recycle Bin refused is said once, and why a file expired is said in its row", () => {
  expect(refusedLine(1)).toEqual({
    sentence: "The Recycle Bin could not take 1 file that expired, so it stays in the Trash.",
    detail: "Its drive may have no Recycle Bin, or it is off or too small.",
  });
  expect(refusedLine(3).sentence).toBe(
    "The Recycle Bin could not take 3 files that expired, so they stay in the Trash.",
  );
  expect(expiredReason({ kind: "age", days: 30 })).toBe("Expired after 30 days");
  expect(expiredReason({ kind: "size", bytes: 25 * GB })).toBe(
    "Expired to keep the Trash under 25 GB",
  );
});

test("Empty Trash… asks with how many files and how much, and says they do not come back", () => {
  expect(text(emptyQuestion({ count: 312, bytes: 8.4 * GB }))).toBe(
    "Delete the 312 files in the Trash, 8.4 GB, for good? They do not go to the Recycle Bin, and Undo cannot bring them back.",
  );
  expect(emptyQuestion(tally(1, 2))[1]).toEqual({ term: "1 file" });
});

test("emptying counts as it goes, and the foot says what went or what stayed", () => {
  expect(emptyingLine(120, 312)).toBe("Emptying · 120 of 312 files");
  const all = { deleted: 312, bytes: 8.4 * GB, kept: 0, firstKept: null, inUse: false };
  expect(emptiedLine(all)).toBe("Emptied the Trash: 312 files, 8.4 GB, deleted for good.");
  const two = { ...all, deleted: 310, kept: 2, firstKept: 7, inUse: true };
  expect(keptLine(two)).toBe(
    "Deleted 310 of 312 files. 2 are open in another app and stay in the Trash.",
  );
  expect(keptLine({ ...two, kept: 1, inUse: false })).toBe(
    "Deleted 310 of 311 files. 1 could not be deleted and stays in the Trash.",
  );
});

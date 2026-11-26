import { expect, test } from "vitest";

import type { Stayed } from "../../ipc/bindings/Stayed";
import { formatBytes } from "../../lib/format";
import {
  emptiedBannerLine,
  emptiedLine,
  emptyingLine,
  emptyQuestion,
  type Said,
  skippedLine,
} from "./empty-words";

// Artboards › The Trash in the Recycle Bin.

const sentence = (said: Said) =>
  said.map((part) => (typeof part === "string" ? part : part.term)).join("");

test("the question names how many and how much, and that only these go, permanently", () => {
  const size = formatBytes(18_400_000_000);
  expect(sentence(emptyQuestion({ count: 312, bytes: 18_400_000_000 }))).toBe(
    `Permanently delete the 312 files the library sent to the Recycle Bin, ${size}? The rest of the Recycle Bin stays. Undo cannot bring them back.`,
  );
  expect(sentence(emptyQuestion({ count: 1, bytes: 2_400_000 }))).toBe(
    `Permanently delete the file the library sent to the Recycle Bin, ${formatBytes(2_400_000)}? The rest of the Recycle Bin stays. Undo cannot bring it back.`,
  );
  expect(emptyQuestion({ count: 312, bytes: 1 })[1]).toEqual({ term: "312 files" });
});

test("the head counts as it goes", () => {
  expect(emptyingLine(120, 312)).toBe("Emptying · 120 of 312 files");
});

const stayed = (name: string): Stayed => ({
  kind: "file",
  id: 7,
  name,
  at: { kind: "trash" },
  reason: { kind: "inUse" },
});

test("the foot says what went, and what was skipped and why", () => {
  const none = { gone: 0, kept: 0, stayed: [] };
  expect(emptiedLine({ deleted: 312, bytes: 18_400_000_000, ...none })).toBe(
    `Emptied the Trash: 312 files, ${formatBytes(18_400_000_000)}, permanently deleted.`,
  );
  const one = [stayed("a.jpg")];
  expect(skippedLine({ deleted: 309, bytes: 0, gone: 2, kept: 1, stayed: one })).toBe(
    "Permanently deleted 309 of 312 files. 2 were no longer in the Recycle Bin, and 1 would not go and stays in the Trash.",
  );
  expect(skippedLine({ deleted: 4, bytes: 0, gone: 1, kept: 0, stayed: [] })).toBe(
    "Permanently deleted 4 of 5 files. 1 was no longer in the Recycle Bin.",
  );
  expect(skippedLine({ deleted: 0, bytes: 0, gone: 0, kept: 2, stayed: one })).toBe(
    "Emptied none of the 2 files. 2 would not go and stay in the Trash.",
  );
});

test("the banner over what stayed counts what went, or names what could not go", () => {
  const one = [stayed("a.jpg")];
  expect(emptiedBannerLine({ deleted: 309, bytes: 0, gone: 2, kept: 1, stayed: one })).toBe(
    "309 of 312 files were permanently deleted",
  );
  expect(emptiedBannerLine({ deleted: 1, bytes: 0, gone: 0, kept: 1, stayed: one })).toBe(
    "1 of 2 files was permanently deleted",
  );
  expect(emptiedBannerLine({ deleted: 0, bytes: 0, gone: 1, kept: 1, stayed: one })).toBe(
    "a.jpg could not be permanently deleted",
  );
  const two = [stayed("a.jpg"), stayed("b.jpg")];
  expect(emptiedBannerLine({ deleted: 0, bytes: 0, gone: 0, kept: 2, stayed: two })).toBe(
    "The 2 files could not be permanently deleted",
  );
});

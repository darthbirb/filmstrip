import { expect, test } from "vitest";

import { NOTHING, pruned, ranged, toggled } from "./selection";

const ORDER = [1, 2, 3, 4, 5, 6];

test("a box checks, then unchecks, and checking it is where the next range starts", () => {
  const one = toggled(NOTHING, 3);
  expect(one).toEqual({ ids: [3], anchor: 3 });
  const two = toggled(one, 5);
  expect(two).toEqual({ ids: [3, 5], anchor: 5 });
  expect(toggled(two, 3)).toEqual({ ids: [5], anchor: 5 });
});

test("Shift takes the tiles from the last one checked and replaces the set", () => {
  const from = { ids: [1, 2], anchor: 2 };
  expect(ranged(from, ORDER, 5, false, null)).toEqual({ ids: [2, 3, 4, 5], anchor: 2 });
  // Backwards runs the same way, in the place's order.
  expect(ranged({ ids: [5], anchor: 5 }, ORDER, 3, false, null).ids).toEqual([3, 4, 5]);
});

test("Ctrl+Shift adds the range to what is checked", () => {
  const from = { ids: [1, 5], anchor: 5 };
  expect(ranged(from, ORDER, 6, true, null)).toEqual({ ids: [1, 5, 6], anchor: 5 });
});

test("with nothing checked the range starts at the tile in the pane, else at the tile itself", () => {
  expect(ranged(NOTHING, ORDER, 4, false, 2)).toEqual({ ids: [2, 3, 4], anchor: 2 });
  expect(ranged(NOTHING, ORDER, 4, false, null)).toEqual({ ids: [4], anchor: 4 });
  // A pane showing a file from somewhere else starts nothing.
  expect(ranged(NOTHING, ORDER, 4, false, 99)).toEqual({ ids: [4], anchor: 4 });
});

test("a file that leaves the grid leaves the set, and the last one leaving empties it", () => {
  const from = { ids: [2, 4, 6], anchor: 4 };
  expect(pruned(from, new Set([1, 2, 3, 5, 6]))).toEqual({ ids: [2, 6], anchor: null });
  expect(pruned(from, new Set(ORDER))).toBe(from);
  expect(pruned(from, new Set([1]))).toBe(NOTHING);
});

import { expect, test } from "vitest";

import { justified, type LayoutRequest, layout, rowAt, uniform } from "./layout";

const request = (aspects: number[], overrides: Partial<LayoutRequest> = {}): LayoutRequest => ({
  id: 1,
  mode: "justified",
  aspects: Float32Array.from(aspects),
  width: 1000,
  target: 200,
  gap: 4,
  ...overrides,
});

const rowRight = (result: ReturnType<typeof justified>, row: number) => {
  const last = (result.rowStart[row] ?? 0) + (result.rowLength[row] ?? 0) - 1;
  return (result.itemLeft[last] ?? 0) + (result.itemWidth[last] ?? 0);
};

test("justified rows fill the width edge to edge, and keep each picture's shape", () => {
  const aspects = [1.5, 0.75, 1, 1.33, 1.5, 2, 0.66, 1, 1.5, 1.2];
  const result = justified(request(aspects));
  expect(result.rows).toBeGreaterThan(1);
  for (let row = 0; row < result.rows - 1; row += 1) {
    expect(rowRight(result, row)).toBeCloseTo(1000, 1);
  }
  for (const [index, aspect] of aspects.entries()) {
    const row = rowAt(result.rowTops, result.rows, result.rowTops[0] ?? 0);
    expect(row).toBe(0);
    const height = result.rowHeights[
      [...result.rowStart].findLastIndex((start) => start <= index)
    ] as number;
    expect((result.itemWidth[index] ?? 0) / height).toBeCloseTo(aspect, 3);
  }
});

test("the last row keeps the target height instead of stretching to fill", () => {
  const result = justified(request([1, 1, 1, 1, 1, 1, 1]));
  expect(result.rowHeights[result.rows - 1]).toBe(200);
  expect(rowRight(result, result.rows - 1)).toBeLessThan(1000);
});

test("row tops climb one row at a time and end at the total height", () => {
  const result = justified(request(Array.from({ length: 40 }, (_, n) => 0.6 + (n % 5) * 0.3)));
  for (let row = 0; row < result.rows; row += 1) {
    const top = result.rowTops[row] ?? 0;
    expect(result.rowTops[row + 1]).toBeCloseTo(
      row + 1 === result.rows ? result.totalHeight : top + (result.rowHeights[row] ?? 0) + 4,
      3,
    );
  }
});

test("uniform cells are square, and as many fit as the target size allows", () => {
  const result = uniform(
    request(
      Array.from({ length: 11 }, () => 1.5),
      { mode: "uniform" },
    ),
  );
  const columns = result.rowLength[0] ?? 0;
  expect(columns).toBe(5);
  expect(result.rows).toBe(3);
  expect(result.rowLength[2]).toBe(1);
  expect(result.itemWidth[0]).toBeCloseTo(result.rowHeights[0] ?? 0);
  expect(rowRight(result, 0)).toBeCloseTo(1000, 3);
});

test("nothing to lay out, or no room, gives an empty layout rather than an error", () => {
  expect(justified(request([])).rows).toBe(0);
  expect(justified(request([1, 2], { width: 0 })).rows).toBe(0);
  expect(uniform(request([], { mode: "uniform" })).rowTops).toEqual(new Float32Array([0]));
});

test("rowAt finds the row that holds a scroll position", () => {
  const tops = Float32Array.from([0, 100, 250, 400]);
  expect(rowAt(tops, 3, 0)).toBe(0);
  expect(rowAt(tops, 3, 99)).toBe(0);
  expect(rowAt(tops, 3, 100)).toBe(1);
  expect(rowAt(tops, 3, 399)).toBe(2);
  expect(rowAt(tops, 3, 5000)).toBe(2);
});

test("each group starts a row of its own under room for its heading, with room under every row", () => {
  const aspects = Float32Array.from([1, 1, 1, 1, 1, 1, 1]);
  const grouped = layout({
    ...request([...aspects]),
    groups: Uint32Array.from([0, 3]),
    lead: 30,
    below: 20,
  });
  const plain = justified(request([...aspects.subarray(0, 3)]));

  // Its heading's room, its one row with the room under it, then the gap before the next group.
  expect([...grouped.groupTops]).toEqual([0, 30 + plain.totalHeight + 20 + 4]);
  // The first group's row sits under its heading, where the lone layout of the same three would.
  expect(grouped.rowTops[0]).toBe(30);
  expect(grouped.rowStart[1]).toBe(3);
  expect(grouped.rowTops[1]).toBe((grouped.groupTops[1] ?? 0) + 30);
  expect(grouped.itemLeft[3]).toBe(0);
  expect(grouped.totalHeight).toBe(grouped.rowTops[grouped.rows]);
});

test("without groups, a layout is the one it always was", () => {
  const aspects = [1.5, 0.75, 1, 1.33, 1.5, 2];
  expect(layout(request(aspects))).toEqual(justified(request(aspects)));
});

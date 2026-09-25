import { expect, test } from "vitest";

import { rowOf, step } from "./keys";

// Three rows of 100px tiles: four across, then three offset by half a tile, then two.
const ROWS = {
  rows: 3,
  rowTops: Float32Array.from([0, 110, 220, 330]),
  rowStart: Uint32Array.from([0, 4, 7]),
  rowLength: Uint32Array.from([4, 3, 2]),
  itemLeft: Float32Array.from([0, 110, 220, 330, 50, 160, 270, 0, 110]),
  itemWidth: Float32Array.from([100, 100, 100, 100, 100, 100, 100, 100, 100]),
};

test("a tile's row is found from where each row starts", () => {
  expect([0, 3, 4, 6, 7, 8].map((index) => rowOf(ROWS, index))).toEqual([0, 0, 1, 1, 2, 2]);
});

test("left and right run in reading order across rows, and stop at either end", () => {
  expect(step(ROWS, 9, 3, "ArrowRight", 200)).toBe(4);
  expect(step(ROWS, 9, 4, "ArrowLeft", 200)).toBe(3);
  expect(step(ROWS, 9, 0, "ArrowLeft", 200)).toBe(0);
  expect(step(ROWS, 9, 8, "ArrowRight", 200)).toBe(8);
});

test("up and down keep the column as near as the rows allow", () => {
  // The third tile's middle is 270, and the next row's third tile sits at 270 to 370.
  expect(step(ROWS, 9, 2, "ArrowDown", 200)).toBe(6);
  expect(step(ROWS, 9, 3, "ArrowDown", 200)).toBe(6);
  expect(step(ROWS, 9, 5, "ArrowUp", 200)).toBe(1);
  expect(step(ROWS, 9, 1, "ArrowUp", 200)).toBe(1);
  expect(step(ROWS, 9, 8, "ArrowDown", 200)).toBe(8);
});

test("Home and End take the place's ends, and a page goes a screen's height", () => {
  expect(step(ROWS, 9, 5, "Home", 200)).toBe(0);
  expect(step(ROWS, 9, 5, "End", 200)).toBe(8);
  expect(step(ROWS, 9, 1, "PageDown", 220)).toBe(8);
  expect(step(ROWS, 9, 8, "PageUp", 220)).toBe(1);
});

test("any other key moves nothing", () => {
  expect(step(ROWS, 9, 2, "a", 200)).toBeNull();
});

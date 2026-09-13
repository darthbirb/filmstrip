import { expect, test } from "vitest";

import { contrast } from "./contrast";

test("contrast runs from 1 to 21, whichever colour comes first", () => {
  expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
  expect(contrast([120, 40, 200], [120, 40, 200])).toBe(1);
});

test("the grey that just misses AA on white is measured as missing it", () => {
  expect(contrast([0x77, 0x77, 0x77], [255, 255, 255])).toBeCloseTo(4.48, 2);
});

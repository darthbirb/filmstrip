import { expect, test } from "vitest";

import { EQUAL, type Least, layOutSet, place, scaleLimit } from "./set-layout";

// The boards on Pane › several: a 20rem pane's media area is 304 × 386, a 14rem one's 208 × 386,
// with the tile-gap between files and pane-set-least at the root size of 16px.
const WIDE = { width: 304, height: 386 };
const NARROW = { width: 208, height: 386 };
const GAP = 6;
const LEAST: Least = { short: 36, long: 64 };

const photo = { width: 4000, height: 3000 };
const portrait = { width: 3000, height: 4000 };
const square = { width: 4000, height: 4000 };
const strip = { width: 6000, height: 2000 };
const TWELVE = [1, 2, 3].flatMap(() => [photo, portrait, square, strip]);

const percent = (scale: number) => Math.round(scale * 1e6) / 1e4;
const size = (file: { width: number; height: number }) => [
  Math.round(file.width * 100) / 100,
  Math.round(file.height * 100) / 100,
];

test("three files draw one to a row at one scale, a clip half as wide as the photographs", () => {
  const clip = { width: 1920, height: 1080 };
  const set = layOutSet([clip, photo, photo], WIDE, GAP, LEAST);
  expect(set.rows).toEqual([1, 1, 1]);
  expect(percent(set.scale)).toBeCloseTo(5.2825, 3);
  const [first, second] = set.files;
  expect((first?.drawn.width ?? 0) / (second?.drawn.width ?? 1)).toBeCloseTo(1920 / 4000, 9);

  const narrow = layOutSet([clip, photo, photo], NARROW, GAP, LEAST);
  expect(narrow.rows).toEqual([1, 1, 1]);
  expect(percent(narrow.scale)).toBeCloseTo(5.2, 6);
});

test("twelve draw as large split 3+1+3+2+3 as 3+2+3+3+1, and the earlier rows fuller wins", () => {
  const set = layOutSet(TWELVE, WIDE, GAP, LEAST);
  expect(set.rows).toEqual([3, 2, 3, 3, 1]);
  expect(percent(set.scale)).toBeCloseTo(2.1294, 3);
  expect(size(set.files[0]?.drawn ?? photo)).toEqual([85.18, 63.88]);
  expect(size(set.files[3]?.drawn ?? photo)).toEqual([127.76, 42.59]);
  // The rows and the gaps between them fill the area's height.
  const heights = [85.18, 63.88, 85.18, 85.18, 42.59];
  expect(heights.reduce((sum, one) => sum + one) + GAP * 4).toBeCloseTo(386, 0);
});

test("the same twelve in the narrowest pane tie three ways, and keep 3+2+2+1+3+1", () => {
  const set = layOutSet(TWELVE, NARROW, GAP, LEAST);
  expect(set.rows).toEqual([3, 2, 2, 1, 3, 1]);
  expect(percent(set.scale)).toBeCloseTo(1.7818, 3);
});

test("the scale stops at 100%, and two rows tied with one at it go to one", () => {
  const set = layOutSet(
    [
      { width: 160, height: 160 },
      { width: 96, height: 96 },
    ],
    WIDE,
    GAP,
    LEAST,
  );
  expect(set.scale).toBe(1);
  expect(set.rows).toEqual([2]);
  expect(set.files.map((one) => size(one.drawn))).toEqual([
    [160, 160],
    [96, 96],
  ]);
});

test("a clip among photographs stops at the floor, and the search counts it at that size", () => {
  const clip = { width: 640, height: 360 };
  const big = { width: 6000, height: 4000 };
  const set = layOutSet([clip, big, big], WIDE, GAP, LEAST);
  expect(set.rows).toEqual([1, 1, 1]);
  expect(percent(set.scale)).toBeCloseTo(4.225, 6);
  expect(size(set.files[0]?.drawn ?? clip)).toEqual([64, 36]);
  expect(size(set.files[1]?.drawn ?? clip)).toEqual([253.5, 169]);
});

test("a file smaller than the floor at its own pixels is drawn up to it", () => {
  const tiny = place({ width: 20, height: 10 }, 1, WIDE, LEAST);
  expect(size(tiny.drawn)).toEqual([72, 36]);
  expect(size(tiny.box)).toEqual([72, 36]);
  const tall = place({ width: 10, height: 40 }, 1, WIDE, LEAST);
  expect(size(tall.drawn)).toEqual([36, 144]);
});

test("a file with no shape stands in at the floor, and takes its room in the rows", () => {
  const none = { width: 0, height: 0 };
  const alone = place(none, 0.05, WIDE, LEAST);
  expect(size(alone.drawn)).toEqual([64, 36]);
  expect(size(alone.box)).toEqual([64, 36]);
  const set = layOutSet([photo, none, photo], WIDE, GAP, LEAST);
  expect(size(set.files[1]?.drawn ?? none)).toEqual([64, 36]);
  expect(set.fits).toBe(true);
  expect(set.rows.reduce((sum, count) => sum + count, 0)).toBe(3);
});

test("a panorama is held to the area in the floor's band, and holds the set's scale there", () => {
  const nile = { width: 12000, height: 1000 };
  const big = { width: 6000, height: 4000 };
  const set = layOutSet([nile, big, big], NARROW, GAP, LEAST);
  const [panorama, photograph] = set.files;
  expect(size(panorama?.drawn ?? nile)).toEqual([208, 17.33]);
  expect(size(panorama?.box ?? nile)).toEqual([208, 36]);
  // The scale itself never draws a file past the area: 1.73%, not the 3.47% the room allows.
  expect(percent(set.scale)).toBeCloseTo(1.7333, 3);
  expect(size(photograph?.drawn ?? big)).toEqual([104, 69.33]);
  expect(set.rows).toEqual([1, 1, 1]);
});

test("no file is ever drawn past the area, nor its band", () => {
  const files = [
    { width: 100, height: 9000 },
    { width: 9000, height: 100 },
    { width: 50, height: 50 },
  ];
  for (const area of [WIDE, NARROW, { width: 120, height: 90 }]) {
    const set = layOutSet(files, area, GAP, LEAST);
    for (const one of set.files) {
      expect(one.drawn.width).toBeLessThanOrEqual(area.width + 1e-9);
      expect(one.drawn.height).toBeLessThanOrEqual(area.height + 1e-9);
      expect(one.box.width).toBeLessThanOrEqual(area.width + 1e-9);
      expect(one.box.height).toBeLessThanOrEqual(area.height + 1e-9);
    }
    expect(set.scale).toBeLessThanOrEqual(scaleLimit(files, area));
  }
});

test("the layout chosen fits its area, and no other split draws more than a millionth larger", () => {
  const shapes = [photo, portrait, square, strip, { width: 1920, height: 1080 }];
  const areas = [WIDE, NARROW, { width: 600, height: 300 }, { width: 1200, height: 800 }];
  for (let n = 2; n <= 7; n += 1) {
    const files = Array.from({ length: n }, (_, at) => shapes[(at * 3) % shapes.length] ?? photo);
    for (const area of areas) {
      const set = layOutSet(files, area, GAP, LEAST);
      expect(set.fits).toBe(true);
      expect(set.rows.reduce((sum, one) => sum + one)).toBe(n);
      let start = 0;
      let height = -GAP;
      for (const count of set.rows) {
        const row = set.files.slice(start, start + count);
        const width = row.reduce((sum, one) => sum + one.box.width, GAP * (count - 1));
        expect(width).toBeLessThanOrEqual(area.width + 1e-6);
        height += Math.max(...row.map((one) => one.box.height)) + GAP;
        start += count;
      }
      expect(height).toBeLessThanOrEqual(area.height + 1e-6);
      expect(set.scale).toBeGreaterThanOrEqual(bruteForce(files, area) * (1 - EQUAL));
    }
  }
});

test("a set too large for the room even at the floor wraps as text does, and says it does not fit", () => {
  const files = Array.from({ length: 12 }, () => photo);
  const set = layOutSet(files, { width: 140, height: 100 }, GAP, LEAST);
  expect(set.fits).toBe(false);
  expect(set.scale).toBe(0);
  // Two 64-wide files and a gap to a row, at the floor.
  expect(set.rows).toEqual([2, 2, 2, 2, 2, 2]);
});

test("nothing to lay out, or no room yet, lays out nothing", () => {
  expect(layOutSet([], WIDE, GAP, LEAST).rows).toEqual([]);
  expect(layOutSet([photo, photo], { width: 0, height: 0 }, GAP, LEAST).fits).toBe(false);
});

/** The largest scale any split draws at, by trying every one: what the search must match. */
function bruteForce(
  files: { width: number; height: number }[],
  area: { width: number; height: number },
) {
  let best = 0;
  const n = files.length;
  for (let mask = 0; mask < 2 ** (n - 1); mask += 1) {
    const rows: number[] = [1];
    for (let at = 1; at < n; at += 1) {
      if (mask & (1 << (at - 1))) rows.push(1);
      else rows[rows.length - 1] = (rows.at(-1) ?? 0) + 1;
    }
    let low = 0;
    let high = scaleLimit(files, area);
    const fits = (scale: number) => {
      const boxes = files.map((file) => place(file, scale, area, LEAST).box);
      let start = 0;
      let height = -GAP;
      for (const count of rows) {
        const row = boxes.slice(start, start + count);
        if (row.reduce((sum, box) => sum + box.width, GAP * (count - 1)) > area.width + 1e-6)
          return false;
        height += Math.max(...row.map((box) => box.height)) + GAP;
        start += count;
      }
      return height <= area.height + 1e-6;
    };
    if (!fits(0)) continue;
    if (fits(high)) low = high;
    for (let step = 0; step < 64 && low < high; step += 1) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    best = Math.max(best, low);
  }
  return best;
}

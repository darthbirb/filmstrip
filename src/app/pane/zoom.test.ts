import { expect, test } from "vitest";

import {
  fitScale,
  MAX_SCALE,
  MIN_SCALE,
  NOTCH_IN,
  NOTCH_OUT,
  panBy,
  pannable,
  placement,
  scaleOf,
  type View,
  zoomAbout,
} from "./zoom";

const IMAGE = { width: 4000, height: 3000 };
const AREA = { width: 400, height: 600 };
const FIT = fitScale(AREA, IMAGE);

/** Where an image point lands on screen, as an offset from the area's centre. */
function onScreen(view: View, point: { x: number; y: number }, fit = FIT, area = AREA) {
  const at = placement(view, fit, IMAGE, area);
  const scale = scaleOf(view, fit);
  return {
    x: at.left + point.x * scale - area.width / 2,
    y: at.top + point.y * scale - area.height / 2,
  };
}

test("a picture fits by shrinking to the area, never by stretching past its own size", () => {
  expect(FIT).toBeCloseTo(0.1);
  expect(fitScale({ width: 4000, height: 4000 }, { width: 800, height: 600 })).toBe(1);
});

test("the first notch out of fit starts from the fitted scale, so nothing jumps", () => {
  const view = zoomAbout(null, NOTCH_IN, { x: 0, y: 0 }, FIT, IMAGE);
  expect(scaleOf(view, FIT)).toBeCloseTo(FIT * NOTCH_IN);
});

test("the point under the pointer stays under it, notch after notch, in and out", () => {
  const pointer = { x: 120, y: -80 };
  let view: View = null;
  const under = { x: IMAGE.width / 2 + pointer.x / FIT, y: IMAGE.height / 2 + pointer.y / FIT };
  for (const factor of [NOTCH_IN, NOTCH_IN, NOTCH_IN, NOTCH_OUT]) {
    view = zoomAbout(view, factor, pointer, FIT, IMAGE);
    const landed = onScreen(view, under);
    expect(landed.x).toBeCloseTo(pointer.x);
    expect(landed.y).toBeCloseTo(pointer.y);
  }
});

test("a picture that fits below a tenth zooms from where it is, not from the floor", () => {
  const huge = { width: 12000, height: 9000 };
  const fit = fitScale(AREA, huge);
  expect(fit).toBeLessThan(MIN_SCALE);
  expect(scaleOf(zoomAbout(null, NOTCH_IN, { x: 0, y: 0 }, fit, huge), fit)).toBeCloseTo(
    fit * NOTCH_IN,
  );
  expect(scaleOf(zoomAbout(null, NOTCH_OUT, { x: 0, y: 0 }, fit, huge), fit)).toBeCloseTo(fit);
});

test("the absolute scale stays between a tenth and twelve times the picture's own pixels", () => {
  let view: View = null;
  for (let notch = 0; notch < 80; notch++)
    view = zoomAbout(view, NOTCH_IN, { x: 0, y: 0 }, FIT, IMAGE);
  expect(scaleOf(view, FIT)).toBeCloseTo(MAX_SCALE);
  for (let notch = 0; notch < 200; notch++)
    view = zoomAbout(view, NOTCH_OUT, { x: 0, y: 0 }, FIT, IMAGE);
  expect(scaleOf(view, FIT)).toBeCloseTo(MIN_SCALE);
});

test("a drag moves the picture by the distance the pointer moved, and a fitted picture not at all", () => {
  const view = zoomAbout(null, 4, { x: 0, y: 0 }, FIT, IMAGE);
  const before = onScreen(view, { x: 1000, y: 1000 });
  const after = onScreen(panBy(view, { x: 30, y: -12 }, FIT), { x: 1000, y: 1000 });
  expect(after.x - before.x).toBeCloseTo(30);
  expect(after.y - before.y).toBeCloseTo(-12);
  expect(panBy(null, { x: 30, y: 0 }, FIT)).toBeNull();
});

test("only a picture that runs past the area has anywhere to be dragged", () => {
  expect(pannable(null, FIT, IMAGE, AREA)).toBe(false);
  expect(pannable(zoomAbout(null, NOTCH_OUT, { x: 0, y: 0 }, FIT, IMAGE), FIT, IMAGE, AREA)).toBe(
    false,
  );
  expect(pannable(zoomAbout(null, 2, { x: 0, y: 0 }, FIT, IMAGE), FIT, IMAGE, AREA)).toBe(true);
});

test("a re-fit keeps the multiple and the point at the centre, so the view is the same view", () => {
  const view = panBy(zoomAbout(null, 3, { x: 40, y: 40 }, FIT, IMAGE), { x: 25, y: 10 }, FIT);
  const wider = { width: 1600, height: 900 };
  const bigger = fitScale(wider, IMAGE);
  // The image point at the centre of the view stays at the centre of the wider area.
  const middle = onScreen(view, view?.centre ?? { x: 0, y: 0 }, bigger, wider);
  expect(middle.x).toBeCloseTo(0);
  expect(middle.y).toBeCloseTo(0);
  expect(scaleOf(view, bigger) / bigger).toBeCloseTo(scaleOf(view, FIT) / FIT);
});

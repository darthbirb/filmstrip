import { expect, test } from "vitest";

import { contrast, type Rgb } from "../lib/contrast";

// The foundation is held to WCAG AA by measurement, as the browser paints it. DESIGN.md "Colors".

const SURFACES = ["well", "ground", "panel", "raised"];

/** A role as the browser paints it, read back from one canvas pixel. */
function painted(role: string): Rgb {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${role}`)
    .trim();
  expect(value, `--color-${role} is defined`).not.toBe("");
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas");
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

test("every ink that sets text can be read on every surface", () => {
  for (const surface of SURFACES) {
    for (const ink of ["fg-hi", "fg", "fg-mid", "fg-dim"]) {
      expect(
        contrast(painted(ink), painted(surface)),
        `${ink} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(painted("focus"), painted(surface)),
      `focus on ${surface}`,
    ).toBeGreaterThanOrEqual(3);
  }
});

test("text on the selection plate can be read", () => {
  expect(contrast(painted("on-plate"), painted("plate"))).toBeGreaterThanOrEqual(4.5);
});

test("the in-pane plate's words can be read, and its ring stands out from every surface", () => {
  expect(contrast(painted("on-mark"), painted("in-pane"))).toBeGreaterThanOrEqual(4.5);
  for (const surface of SURFACES) {
    expect(contrast(painted("in-pane"), painted(surface)), surface).toBeGreaterThanOrEqual(3);
  }
});

test("the close glyph stands out from the red it turns under the pointer", () => {
  // A glyph, not text, so the bar is 3:1.
  expect(contrast(painted("on-danger"), painted("danger"))).toBeGreaterThanOrEqual(3);
});

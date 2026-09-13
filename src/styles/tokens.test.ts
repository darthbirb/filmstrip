import { afterEach, expect, test } from "vitest";

import { LOOKS } from "../app/look";
import { contrast, type Rgb } from "../lib/contrast";

// Every look is held to WCAG AA by measurement, as the browser draws it. DESIGN.md "Colors".

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

afterEach(() => {
  delete document.documentElement.dataset.look;
});

test.each(LOOKS)("the %s look can be read on every surface it paints", (look) => {
  if (look !== LOOKS[0]) document.documentElement.dataset.look = look;
  for (const surface of ["ground", "panel", "raised", "well"]) {
    for (const text of ["fg", "fg-muted"]) {
      expect(
        contrast(painted(text), painted(surface)),
        `${text} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const mark of ["accent", "focus"]) {
      expect(
        contrast(painted(mark), painted(surface)),
        `${mark} on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
  expect(contrast(painted("on-accent"), painted("accent")), "on-accent").toBeGreaterThanOrEqual(
    4.5,
  );
  expect(contrast(painted("on-danger"), painted("danger")), "on-danger").toBeGreaterThanOrEqual(
    4.5,
  );
});

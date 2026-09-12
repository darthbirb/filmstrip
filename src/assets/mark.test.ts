import { expect, test } from "vitest";

import svg from "./mark.svg?raw";

// Keeps the mark to its rule: five frames parted by equal gaps, each with its own sprockets. DECISIONS.md "The mark".
const read = (selector: string) =>
  [...new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll(selector)].map(
    (rect) => ({
      x: Number(rect.getAttribute("x")),
      width: Number(rect.getAttribute("width")),
    }),
  );

test("five frames fill the window, parted by equal gaps", () => {
  const frames = read("rect.frame");
  expect(frames).toHaveLength(5);
  expect(frames[0]?.x).toBe(4);
  const last = frames.at(-1);
  expect((last?.x ?? 0) + (last?.width ?? 0)).toBe(96);

  const gaps = frames
    .slice(1)
    .map((frame, n) => frame.x - ((frames[n]?.x ?? 0) + (frames[n]?.width ?? 0)));
  expect(new Set(gaps).size).toBe(1);
  expect(gaps[0]).toBeGreaterThan(0);
});

test("each frame has one sprocket centred above it and one below", () => {
  const centres = read("rect.frame").map((frame) => frame.x + frame.width / 2);
  const top = read('g.sprockets rect[y="14"]').map((hole) => hole.x + hole.width / 2);
  const bottom = read('g.sprockets rect[y="78"]').map((hole) => hole.x + hole.width / 2);
  expect(top).toEqual(centres);
  expect(bottom).toEqual(centres);
});

import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { Mark, markGeometry } from "./Mark";
import { MARKS } from "./marks";

const CANDIDATES = Object.entries(MARKS);

test.each(CANDIDATES)("%s: draws one frame per colour, inside the window", async (_, spec) => {
  const screen = await render(<Mark spec={spec} />);
  expect(screen.container.querySelectorAll("[data-frame]")).toHaveLength(spec.frames.length);

  const { frames } = markGeometry(spec);
  expect(frames[0]?.x).toBeCloseTo(4);
  const last = frames.at(-1);
  expect((last?.x ?? 0) + (last?.width ?? 0)).toBeCloseTo(96);
  for (const [n, frame] of frames.entries()) {
    const next = frames[n + 1];
    if (next) expect(next.x - (frame.x + frame.width)).toBeCloseTo(spec.gap);
  }
});

test.each(CANDIDATES.filter(([, spec]) => spec.sprockets === "per-frame"))(
  "%s: centres one sprocket over each frame",
  (_, spec) => {
    const { frames, sprockets } = markGeometry(spec);
    expect(sprockets).toHaveLength(frames.length);
    for (const [n, frame] of frames.entries()) {
      expect((sprockets[n] ?? 0) + 4).toBeCloseTo(frame.x + frame.width / 2);
    }
  },
);

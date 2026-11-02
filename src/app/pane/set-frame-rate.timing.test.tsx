import { expect, test } from "vitest";
import { page } from "vitest/browser";

import { benchSet, displayRate } from "../../dev/set-bench";
import { paneSetLimit, paneSetPlaying } from "./pane-store";

// These hold `pane-set` and `pane-set-playing` to the counts they were set from.
// DECISIONS.md "Several files in the pane".

test("the limit's worth of originals holds the frame rate while the pane is resized", {
  timeout: 180_000,
}, async () => {
  await page.viewport(1600, 1000);
  const display = await displayRate();
  const bench = await benchSet(paneSetLimit(), { motion: "resize", ms: 5000 });
  expect(bench.rate).toBeGreaterThan(display * 0.9);
  expect(bench.late / bench.intervals).toBeLessThan(0.1);
});

test("the clips that play at once, among the limit's worth, keep time and drop under 1%", {
  timeout: 180_000,
}, async () => {
  await page.viewport(1600, 1000);
  // The first clips a browser decodes start slow whatever the set, so one run warms it.
  await benchSet(paneSetLimit(), { clips: paneSetPlaying(), ms: 1000 });
  const bench = await benchSet(paneSetLimit(), { clips: paneSetPlaying(), ms: 5000, spans: 3 });
  expect(bench.spans.every((span) => span.due > 0)).toBe(true);
  const counts = bench.spans.map((span) => `${span.dropped}/${span.due}`).join(" ");
  const paces = bench.spans.map((span) => span.pace.toFixed(3)).join(" ");
  console.info(`dropped ${counts}, pace ${paces}`);
  const middle = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  expect(middle(bench.spans.map((span) => span.dropped / span.due))).toBeLessThan(0.01);
  expect(middle(bench.spans.map((span) => span.pace))).toBeGreaterThan(0.95);
});

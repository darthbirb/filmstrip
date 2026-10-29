import { expect, test } from "vitest";
import { page } from "vitest/browser";

import { benchSet, displayRate } from "../../dev/set-bench";
import { paneSetLimit, paneSetPlaying } from "./pane-store";

// `pane-set` and `pane-set-playing` are set from these measurements.
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

test("the clips that play at once, among the limit's worth, drop no more than one frame in 100", {
  timeout: 180_000,
}, async () => {
  await page.viewport(1600, 1000);
  // The first clips a browser decodes start slow whatever the set, so one run warms it.
  await benchSet(paneSetLimit(), { clips: paneSetPlaying(), ms: 1000 });
  const bench = await benchSet(paneSetLimit(), { clips: paneSetPlaying(), ms: 5000, spans: 3 });
  expect(bench.spans.every((span) => span.due > 0)).toBe(true);
  console.info(`dropped ${bench.spans.map((span) => `${span.dropped}/${span.due}`).join(" ")}`);
  const shares = bench.spans.map((span) => span.dropped / span.due).sort((a, b) => a - b);
  expect(shares[Math.floor(shares.length / 2)]).toBeLessThan(0.01);
});

import { expect, test } from "vitest";
import { page } from "vitest/browser";

import { benchSet, frames } from "../../dev/set-bench";
import { paneSetLimit } from "./pane-store";

// `pane-set` is set from this measurement: the limit's worth of 6000 × 4000 originals in a
// full-screen pane hold the display's frame rate. DECISIONS.md "Several files in the pane".

test("the limit's worth of originals holds the display's frame rate", {
  timeout: 120_000,
}, async () => {
  await page.viewport(1600, 1000);
  const idle = await frames(1000);
  const display = (idle.length - 1) / (((idle.at(-1) ?? 0) - (idle[0] ?? 0)) / 1000);
  const bench = await benchSet(paneSetLimit(), 0);
  expect(bench.rate).toBeGreaterThan(display * 0.95);
  // Under one frame in twenty may come late.
  expect(bench.late / bench.intervals).toBeLessThan(0.05);
});

import { afterAll, expect, test } from "vitest";
import { commands, page } from "vitest/browser";

import type { Footage } from "../../../tests/footage";
import { type Bench, benchSet, displayRate } from "../../dev/set-bench";
import { paneSetLimit } from "./pane-store";

// These hold `pane-set` to the count it was set from, and the clips the pane settles on playing
// to keeping time. DECISIONS.md "Several files in the pane".

test("the limit's worth of originals holds the frame rate while the pane is resized", {
  timeout: 180_000,
}, async () => {
  await page.viewport(1600, 1000);
  const display = await displayRate();
  const bench = await benchSet(paneSetLimit(), { motion: "resize", ms: 5000 });
  expect(bench.rate).toBeGreaterThan(display * 0.9);
  expect(bench.late / bench.intervals).toBeLessThan(0.1);
});

test("the clips the pane settles on playing, of the limit's worth, keep time and drop under 1%", {
  timeout: 600_000,
}, async () => {
  await page.viewport(1600, 1000);
  const limit = paneSetLimit();
  keepsTime(await benchSet(limit, { clips: limit, ms: 5000, spans: 3 }), "recorded webm");
});

afterAll(() => commands.removeFootage());

// What phones record, at about the rate they record it; `all` of them play where decoded in
// hardware, so a pane that pauses more than it must fails. DECISIONS.md "Several files in the pane".
const PHONE: (Footage & { type: string; all?: boolean })[] = (
  [
    { codec: "h264", width: 1920, height: 1080, fps: 30, mbps: 17, type: "avc1.640033", all: true },
    { codec: "h264", width: 1920, height: 1080, fps: 60, mbps: 25, type: "avc1.640033" },
    { codec: "h264", width: 3840, height: 2160, fps: 30, mbps: 45, type: "avc1.640033" },
    { codec: "hevc", width: 1920, height: 1080, fps: 60, mbps: 15, type: "hvc1.1.6.L153.B0" },
    { codec: "hevc", width: 3840, height: 2160, fps: 30, mbps: 30, type: "hvc1.1.6.L153.B0" },
  ] as const
).map((one) => ({ ...one, seconds: 22 }));

test.for(PHONE)(
  "the clips the pane settles on playing keep time with $codec at $height p$fps",
  {
    timeout: 600_000,
  },
  async ({ type, all, ...footage }, context) => {
    const { codec, width, height, fps, mbps } = footage;
    const contentType = `video/mp4; codecs="${type}"`;
    const decoding = await navigator.mediaCapabilities.decodingInfo({
      type: "file",
      video: { contentType, width, height, framerate: fps, bitrate: mbps * 1_000_000 },
    });
    const label = `${codec} ${width}x${height} ${fps}fps ${mbps}Mbps`;
    if (!decoding.supported || document.createElement("video").canPlayType(contentType) === "") {
      console.info(`${label}: not played here`);
      context.skip();
    }
    await page.viewport(1600, 1000);
    const url = await commands.footage(footage);
    const clip = { url, ms: footage.seconds * 1000, width, height, ext: "mp4" };
    const limit = paneSetLimit();
    const bench = await benchSet(limit, { clips: limit, clip, ms: 5000, spans: 3 });
    keepsTime(bench, `${label}, ${decoding.powerEfficient ? "hardware" : "software"}`);
    if (all && decoding.powerEfficient) expect(bench.playing).toBe(limit);
  },
);

function keepsTime(bench: Bench, label: string) {
  expect(bench.spans.every((span) => span.due > 0)).toBe(true);
  const counts = bench.spans.map((span) => `${span.dropped}/${span.due}`).join(" ");
  const paces = bench.spans.map((span) => span.pace.toFixed(3)).join(" ");
  console.info(
    `${label}: ${bench.playing} playing, window ${bench.rate.toFixed(1)}/s, dropped ${counts}, pace ${paces}`,
  );
  expect(bench.playing).toBeGreaterThan(0);
  const middle = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  expect(middle(bench.spans.map((span) => span.dropped / span.due))).toBeLessThan(0.01);
  expect(middle(bench.spans.map((span) => span.pace))).toBeGreaterThan(0.95);
}

import { afterAll, test } from "vitest";
import { commands, page } from "vitest/browser";

import { benchSet } from "../../dev/set-bench";
import { paneSetLimit } from "./pane-store";

afterAll(() => commands.removeFootage());

const CASES = [
  { codec: "h264", width: 3840, height: 2160, fps: 30, mbps: 45, seconds: 22, clips: 1 },
  { codec: "h264", width: 3840, height: 2160, fps: 30, mbps: 45, seconds: 22, clips: 2 },
  { codec: "h264", width: 3840, height: 2160, fps: 30, mbps: 45, seconds: 22, clips: 3 },
  { codec: "h264", width: 1920, height: 1080, fps: 60, mbps: 25, seconds: 22, clips: 3 },
  { codec: "h264", width: 1920, height: 1080, fps: 60, mbps: 25, seconds: 22, clips: 5 },
] as const;

test.for(CASES)(
  "probe $height p$fps x$clips",
  { timeout: 600_000 },
  async ({ clips, ...footage }) => {
    await page.viewport(1600, 1000);
    const url = await commands.footage(footage);
    const clip = { url, ms: 22_000, width: footage.width, height: footage.height, ext: "mp4" };
    await benchSet(paneSetLimit(), { clips, clip, ms: 1000 });
    const bench = await benchSet(paneSetLimit(), { clips, clip, ms: 5000, spans: 3 });
    const counts = bench.spans.map((span) => `${span.dropped}/${span.due}`).join(" ");
    const paces = bench.spans.map((span) => span.pace.toFixed(3)).join(" ");
    console.info(
      `probe ${footage.height}p${footage.fps} x${clips}: window ${bench.rate.toFixed(1)}/s, dropped ${counts}, pace ${paces}`,
    );
  },
);

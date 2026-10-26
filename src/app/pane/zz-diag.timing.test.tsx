import { test } from "vitest";
import { page } from "vitest/browser";

import { benchSet } from "../../dev/set-bench";

function watch() {
  const events: string[] = [];
  const last = new Map<HTMLVideoElement, number>();
  let on = true;
  let prev = 0;
  let first = 0;
  const step = (now: number) => {
    first ||= now;
    if (prev && now - prev > 40)
      events.push(`gap${Math.round(now - prev)}@${Math.round(now - first)}`);
    prev = now;
    let lost = 0;
    let t = 0;
    for (const video of document.querySelectorAll<HTMLVideoElement>("[data-file] video")) {
      const dropped = video.getVideoPlaybackQuality().droppedVideoFrames;
      lost += dropped - (last.get(video) ?? 0);
      last.set(video, dropped);
      t = video.currentTime;
    }
    if (lost > 0) events.push(`d${lost}@${Math.round(now - first)}(t${t.toFixed(1)})`);
    if (on) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => {
    on = false;
    return events;
  };
}

test("diag", { timeout: 1_500_000 }, async () => {
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    console.error(line);
  };
  await page.viewport(1600, 1000);
  await benchSet(12, { clips: 2, ms: 1000 });
  for (const clips of [2, 3, 4, 6]) {
    for (let run = 0; run < 3; run++) {
      const stop = watch();
      const bench = await benchSet(12, { clips, ms: 3000, spans: 4 });
      const events = stop();
      log(
        `DIAG clips ${clips} run ${run}: ${bench.dropped}/${bench.due} [${bench.spans.map((one) => `${one.dropped}/${one.due}`).join(" ")}] rate ${bench.rate.toFixed(1)} | ${events.join(" ")}`,
      );
    }
  }
  for (const count of [12, 24, 48]) {
    const bench = await benchSet(count, { motion: "resize", ms: 5000 });
    log(
      `DIAG resize ${count}: rate ${bench.rate.toFixed(1)} late ${bench.late}/${bench.intervals}`,
    );
  }
  throw new Error(lines.join(" ## "));
});

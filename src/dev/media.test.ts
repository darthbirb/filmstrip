import { expect, test } from "vitest";

import { clip } from "./media";

test("a recorded clip never shows two frames closer than a window drawing 30 a second", async () => {
  const video = document.createElement("video");
  video.muted = true;
  video.src = await clip(320, 180, 1700);
  document.body.append(video);
  try {
    video.playbackRate = 0.25;
    const shown: number[] = [];
    await new Promise<void>((resolve, reject) => {
      const step = (_now: number, frame: VideoFrameCallbackMetadata) => {
        shown.push(frame.mediaTime);
        video.requestVideoFrameCallback(step);
      };
      video.requestVideoFrameCallback(step);
      video.onended = () => resolve();
      video.play().catch(reject);
    });
    const gaps = shown.slice(1).map((at, index) => at - (shown[index] ?? at));
    const seen = gaps.map((gap) => Math.round(gap * 1000)).join(",");
    expect(gaps.length, seen).toBeGreaterThan(20);
    expect(Math.min(...gaps), seen).toBeGreaterThanOrEqual(1 / 30);
    // The line above can pass a pace with no room left, so the usual gap must also clear the window
    // by the 3ms quiet runs took off a gap. DECISIONS.md "Several files in the pane".
    const usual = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
    expect(usual, seen).toBeGreaterThan(1 / 30 + 0.003);
  } finally {
    video.remove();
    URL.revokeObjectURL(video.src);
  }
});

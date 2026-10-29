import { expect, test } from "vitest";

import { clip } from "./media";

test("a recorded clip never shows two frames closer than a window drawing 30 a second", async () => {
  const video = document.createElement("video");
  video.muted = true;
  video.src = await clip(320, 180, 1500);
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
    expect(gaps.length, gaps.map((gap) => Math.round(gap * 1000)).join(",")).toBeGreaterThan(20);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1 / 30);
  } finally {
    video.remove();
    URL.revokeObjectURL(video.src);
  }
});

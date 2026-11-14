import { expect, test } from "vitest";

import { benchSet, recordings } from "./set-bench";

test("one recording serves a warm-up and the longer count after it", async () => {
  const asked: number[] = [];
  const movie = recordings(async (ms) => {
    asked.push(ms);
    return `blob:${ms}`;
  }, 21_000);
  const warm = movie(7000);
  const count = movie(21_000);
  expect(await count.url).toBe(await warm.url);
  expect(count.ms).toBe(21_000);
  expect(asked).toEqual([21_000]);
});

test("a clip longer than the one kept is recorded at its own length", async () => {
  const asked: number[] = [];
  const movie = recordings(async (ms) => {
    asked.push(ms);
    return `blob:${ms}`;
  }, 1000);
  await movie(1000).url;
  expect(await movie(4000).url).toBe("blob:4000");
  expect(await movie(2000).url).toBe("blob:4000");
  expect(asked).toEqual([1000, 4000]);
});

test("a recording that fails is not kept, so the next bench records again", async () => {
  let calls = 0;
  const movie = recordings(async () => {
    calls += 1;
    if (calls === 1) throw new Error("the encoder wrote no frame in 30 seconds");
    return "blob:clip";
  }, 1000);
  await expect(movie(1000).url).rejects.toThrow("no frame");
  expect(await movie(1000).url).toBe("blob:clip");
  expect(calls).toBe(2);
});

test("a clip given that would loop in more than one span is refused before the pane is touched", async () => {
  const clip = { url: "blob:footage", ms: 14_000, width: 1920, height: 1080, ext: "mp4" };
  await expect(benchSet(12, { clips: 12, clip, ms: 5000, spans: 3 })).rejects.toThrow(
    "a 14000ms clip would loop in more than one span of the count",
  );
  expect(document.querySelector("[data-file]")).toBeNull();
});

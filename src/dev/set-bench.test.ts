import { expect, test } from "vitest";

import { benchSet, clock, framesIn, recordings, type Sample, tick } from "./set-bench";

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

const FRAME = 1000 / 30;

/** The pace of a clip read every frame for `ms`, showing `shows(at)` at `at` ms in. */
function pace(ms: number, shows: (at: number) => number) {
  let held = clock(shows(0), 0);
  for (let at = FRAME; at <= ms; at += FRAME) held = tick(held, shows(at), at);
  return held.moved / held.seconds;
}

test("a loop's restart, the clock held at the start, does not count against the pace", () => {
  const looped = (at: number) => {
    const time = 20 + at / 1000;
    if (time < 22) return time;
    return Math.max(0, (at - 2000 - 383) / 1000);
  };
  expect(pace(5000, looped)).toBeCloseTo(1, 3);
});

test("a hold after a loop longer than one of the pane's spans counts against the pace", () => {
  const held = (at: number) => {
    if (at < 1000) return 21 + at / 1000;
    return Math.max(0, (at - 4000) / 1000);
  };
  expect(pace(5000, held)).toBeCloseTo(2 / 3, 1);
});

test("a stall away from a loop counts against the pace", () => {
  const stalled = (at: number) => 10 + (at < 2000 ? at : at < 2383 ? 2000 : at - 383) / 1000;
  expect(pace(5000, stalled)).toBeCloseTo(0.923, 2);
});

test("a clip slow throughout reads slow across its loop", () => {
  expect(pace(5000, (at) => (20 + (0.9 * at) / 1000) % 22)).toBeCloseTo(0.9, 3);
});

/** A clip read every frame for `ms`, each frame due and its `n`th dropped where `drops(n, at)`. */
function readings(ms: number, drops: (n: number, at: number) => boolean) {
  const samples: Sample[] = [{ at: 0, dropped: 0, due: 0 }];
  for (let n = 1; n * FRAME <= ms; n += 1) {
    const at = n * FRAME;
    const was = samples.at(-1) ?? { dropped: 0, due: 0 };
    samples.push({ at, dropped: was.dropped + (drops(n, at) ? 1 : 0), due: was.due + 1 });
  }
  return samples;
}

test("frames dropped around a loop, before it and after, are left out of the span", () => {
  const samples = readings(15_000, (_, at) => Math.abs(at - 7500) < 300);
  const span = framesIn(samples, [7500], 5000, 10_000);
  expect(span.dropped).toBe(0);
  expect(span.due).toBeGreaterThan(0);
  expect(span.nearLoops.dropped).toBeGreaterThan(0);
  expect(framesIn(samples, [], 5000, 10_000).dropped).toBe(span.nearLoops.dropped);
});

test("a clip dropping throughout still drops 2% in the middle span across its loop", () => {
  const samples = readings(15_000, (n) => n % 50 === 25);
  const shares = [0, 5000, 10_000].map((from) => {
    const span = framesIn(samples, [7500], from, from + 5000);
    return span.dropped / span.due;
  });
  const middle = [...shares].sort((a, b) => a - b)[1];
  expect(middle).toBeCloseTo(0.02, 3);
});

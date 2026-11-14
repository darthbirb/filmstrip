import { expect, test } from "vitest";

import { KEEP, type Keeper, keeper, observe, type Reading, restart } from "./keep-time";

/** What each playing clip shows over a span, given which play and which span it is. */
type Machine = (playing: readonly number[], tick: number) => { pace: number; dropped: number };

/**
 * A machine that shows `budget` clips' worth of frames a span, every clip slowed alike past it;
 * a clip `weighs` that many clips' worth.
 */
const budget =
  (most: number | ((tick: number) => number), weighs = (_: number) => 1): Machine =>
  (playing, tick) => {
    const room = typeof most === "number" ? most : most(tick);
    const load = playing.reduce((sum, id) => sum + weighs(id), 0);
    return { pace: Math.min(1, room / load), dropped: 0 };
  };

const FRAMES = 60;

/** Runs the keeper over `ticks` spans of `order` on `machine`; the count playing after each. */
function run(
  order: readonly number[],
  machine: Machine,
  ticks: number,
  { from = keeper(), duration = 3600 }: { from?: Keeper; duration?: number } = {},
) {
  let held = from;
  const clocks = new Map<number, Reading>();
  const counts: number[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const playing = order.slice(0, held.limit);
    const shows = machine(playing, tick);
    for (const id of order) {
      const was = clocks.get(id) ?? { time: 0, duration, dropped: 0, due: 0, paused: true };
      const seconds = (shows.pace * KEEP.span) / 1000;
      clocks.set(
        id,
        playing.includes(id)
          ? {
              time: (was.time + seconds) % duration,
              duration,
              dropped: was.dropped + Math.round(shows.dropped * FRAMES),
              due: was.due + FRAMES,
              paused: false,
            }
          : { ...was, paused: true },
      );
    }
    const readings = new Map(playing.map((id) => [id, clocks.get(id) as Reading]));
    held = observe(held, order, readings, (tick + 1) * KEEP.span);
    counts.push(Math.min(held.limit, order.length));
  }
  return { held, counts };
}

const FIVE = [1, 2, 3, 4, 5];

test("every clip plays while the machine keeps time with them", () => {
  const { counts } = run(FIVE, budget(12), 60);
  expect(counts.every((count) => count === 5)).toBe(true);
});

test("falling behind pauses the clips added last, as many as the measure says it cannot hold", () => {
  const { held, counts } = run(FIVE, budget(2), 4);
  // A span to settle, a reading to start from, then two spans behind: 0.4 of the pace.
  expect(counts).toEqual([5, 5, 5, 2]);
  expect(held.playing).toBe("1,2");
});

test("dropped frames alone are falling behind, a clip at a time when the measure is near", () => {
  const drops: Machine = (playing) => ({ pace: 1, dropped: playing.length > 3 ? 0.03 : 0 });
  const { counts } = run(FIVE, drops, 6 + KEEP.retry);
  expect(counts.slice(0, 7)).toEqual([5, 5, 5, 4, 4, 4, 3]);
  expect(counts.slice(6).every((count) => count === 3)).toBe(true);
});

test("one span behind of three does not pause a clip", () => {
  const hitch: Machine = (_, tick) => ({ pace: tick % 3 === 0 ? 0.5 : 1, dropped: 0 });
  const { counts } = run(FIVE, hitch, 60);
  expect(counts.every((count) => count === 5)).toBe(true);
});

test("after a calm spell one more resumes, and the count that fell only after its wait", () => {
  const { counts } = run(
    FIVE,
    budget((tick) => (tick < 8 ? 2 : 12)),
    60,
  );
  expect(counts[3]).toBe(2);
  const first = (count: number) => counts.indexOf(count, 4);
  expect(first(3) - 3).toBe(KEEP.calm);
  expect(first(4) - first(3)).toBe(KEEP.calm);
  // Five fell, so it waits from the fall, not from the last calm spell.
  expect(first(5)).toBe(3 + KEEP.retry);
  expect(counts.slice(first(5)).every((count) => count === 5)).toBe(true);
});

test("a count that falls again waits twice as long before it is tried again", () => {
  const { counts } = run(FIVE, budget(3), 400);
  const tries = counts.flatMap((count, at) => (count === 4 && counts[at - 1] === 3 ? [at] : []));
  // Each try falls three spans in, and the wait runs from the fall.
  const waits = tries.slice(1).map((at, index) => at - (tries[index] ?? 0) - 3);
  expect(waits.slice(0, 3)).toEqual([KEEP.retry, KEEP.retry * 2, KEEP.retry * 4]);
  expect(counts.filter((count) => count > 4)).toEqual([5, 5, 5]);
});

test("the wait stops at its most", () => {
  const { held } = run(FIVE, budget(3), 3000);
  expect(held.wait).toBe(KEEP.retryMost);
});

test("one clip always plays, however far behind", () => {
  const { counts } = run([1, 2], budget(0.2), 60);
  expect(counts.at(-1)).toBe(1);
  expect(Math.min(...counts)).toBe(1);
});

test("a new clip in the set is tried after a calm spell, though a count fell before", () => {
  const settled = run(FIVE, budget(3), 20);
  expect(settled.counts.at(-1)).toBe(3);
  expect(settled.held.ceiling).toBe(4);
  const { counts } = run([...FIVE, 6], budget(3), KEEP.calm + 2, { from: settled.held });
  expect(counts).toContain(4);
});

test("a clip taken out keeps the count that fell and its wait", () => {
  const settled = run(FIVE, budget(3), 60);
  const { ceiling, wait, limit } = settled.held;
  expect(ceiling).toBe(4);
  expect(wait).toBe(KEEP.retry * 2);
  const { held } = run([1, 2, 3, 4], budget(3), 1, { from: settled.held });
  expect(held.ceiling).toBe(ceiling);
  expect(held.wait).toBe(wait);
  expect(held.limit).toBe(limit);
});

test("once no clip that played at a fall is left, every clip plays again at once", () => {
  const heavy = Array.from({ length: 12 }, (_, at) => at + 1);
  const light = Array.from({ length: 9 }, (_, at) => at + 21);
  // Room for nine light clips, or three heavy ones.
  const machine = budget(9, (id) => (id > 20 ? 1 : 3));
  const settled = run(heavy, machine, 20);
  expect(settled.counts.at(-1)).toBe(3);
  // Taken out and added a step at a time, as the pane allows: no tick sees a set all new.
  const kept = run([1, 2, 3], machine, 1, { from: settled.held });
  const added = run([1, 2, 3, ...light], machine, 1, { from: kept.held });
  expect(added.counts[0]).toBeLessThan(light.length);
  const { held, counts } = run(light, machine, 1, { from: added.held });
  expect(counts).toEqual([9]);
  expect(held.ceiling).toBeNull();
  expect(held.wait).toBe(KEEP.retry);
});

test("once no clip that played at a fall is left, the count that fell and its wait are forgotten", () => {
  const nine = Array.from({ length: 9 }, (_, at) => at + 4);
  const fell = run([1, 2, 3], budget(2), 4);
  expect(fell.counts.at(-1)).toBe(2);
  // Nine added, then three tried again after the calm spell and once more after its wait.
  const again = run([1, 2, 3, ...nine], budget(2), 41, { from: fell.held });
  expect(again.counts.at(-1)).toBe(2);
  expect(again.held.ceiling).toBe(3);
  expect(again.held.wait).toBe(KEEP.retry * 2);
  const lifted = run(nine, budget(2), 1, { from: again.held });
  expect(lifted.counts).toEqual([9]);
  expect(lifted.held.ceiling).toBeNull();
  expect(lifted.held.wait).toBe(KEEP.retry);
  // The nine's first fall waits a minute, where the three's next would have waited four.
  const { held, counts } = run(nine, budget(2), 3, { from: lifted.held });
  expect(counts).toEqual([9, 9, 2]);
  expect(held.ceiling).toBe(9);
  expect(held.wait).toBe(KEEP.retry);
});

test("a clip that played at a fall, still in the set, keeps the limit", () => {
  const settled = run(FIVE, budget(3), 20);
  expect(settled.counts.at(-1)).toBe(3);
  const { counts } = run([1, 6, 7, 8, 9], budget(3), 1, { from: settled.held });
  expect(counts).toEqual([3]);
});

test("clips too short to tell a loop from a stall are not measured", () => {
  const { counts } = run(FIVE, budget(1), 40, { duration: (KEEP.span * 2) / 1000 - 0.1 });
  expect(counts.every((count) => count === 5)).toBe(true);
});

test("a clip whose clock went back looped, and is left out of that span", () => {
  let held = keeper();
  const at = (time: number): Reading => ({ time, duration: 60, dropped: 0, due: 0, paused: false });
  for (const [tick, time] of [0, 0, 2, 0.1, 2.1, 0.2].entries()) {
    held = observe(
      held,
      [1, 2],
      new Map([
        [1, at(time)],
        [2, at(time)],
      ]),
      tick * KEEP.span,
    );
  }
  expect(held.spans).toHaveLength(2);
  expect(held.limit).toBe(Number.POSITIVE_INFINITY);
});

test("hidden, the measure starts over and settles again once shown", () => {
  const { held } = run(FIVE, budget(12), 6);
  expect(held.spans.length).toBeGreaterThan(0);
  const shown = restart(held);
  expect(shown.spans).toEqual([]);
  const next = observe(shown, FIVE, new Map(), 99_000);
  expect(next.age).toBe(0);
  expect(next.last).toBeNull();
});

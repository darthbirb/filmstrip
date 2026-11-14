import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/** The rule's numbers. DECISIONS.md "Several files in the pane". */
export const KEEP = {
  /** How long one measure of the playing clips covers, in ms. */
  span: 2000,
  /** The slowest pace that keeps time. */
  pace: 0.95,
  /** The share of frames due that may drop. */
  dropped: 0.01,
  /** Spans, since the playing clips last changed, with no fall before one more resumes. */
  calm: 5,
  /** Spans before the count that fell is tried again; doubled each time it falls again. */
  retry: 30,
  retryMost: 240,
} as const;

/** What a playing clip shows at one moment. */
export type Reading = {
  /** Its clock, in seconds. */
  time: number;
  duration: number;
  dropped: number;
  due: number;
  paused: boolean;
};

type Measure = { moved: number; seconds: number; dropped: number; due: number };

/** Where the pane stands: how many clips may play, and what it has measured of them. */
export type Keeper = {
  limit: number;
  /** The clips playing, in play order, when last measured. */
  playing: string;
  /** Every clip in the set, sorted. */
  clips: string;
  /** Spans since `playing` last changed. */
  age: number;
  last: { at: number; readings: ReadonlyMap<number, Reading> } | null;
  spans: readonly Measure[];
  /** The fewest clips found falling behind, tried again only after `wait` spans. */
  ceiling: number | null;
  wait: number;
  since: number;
};

export function keeper(): Keeper {
  return {
    limit: Number.POSITIVE_INFINITY,
    playing: "",
    clips: "",
    age: 0,
    last: null,
    spans: [],
    ceiling: null,
    wait: KEEP.retry,
    since: 0,
  };
}

/** Starts the measure over, as after the window was hidden. */
export function restart(held: Keeper): Keeper {
  return { ...held, playing: "", last: null, spans: [] };
}

/**
 * One span's step: `order` is every clip in play order, `readings` what those playing show now.
 * Two spans of the last three behind, and the clips added last pause; a calm spell, and one resumes.
 */
export function observe(
  held: Keeper,
  order: readonly number[],
  readings: ReadonlyMap<number, Reading>,
  at: number,
): Keeper {
  const clips = [...order].sort((a, b) => a - b).join();
  let next: Keeper = { ...held, since: held.since + 1 };
  if (clips !== held.clips) next = { ...next, clips, ceiling: null, wait: KEEP.retry };
  const playing = order.slice(0, next.limit);
  const key = playing.join();
  const to = (limit: number): Keeper => ({
    ...next,
    limit,
    playing: order.slice(0, limit).join(),
    age: 0,
    last: null,
    spans: [],
  });
  if (key !== held.playing) return to(next.limit);
  next = { ...next, age: held.age + 1, last: { at, readings } };
  if (!held.last) return next;

  const span = measure(held.last.readings, readings, (at - held.last.at) / 1000);
  if (span) next = { ...next, spans: [...held.spans, span].slice(-3) };
  const count = playing.length;
  if (count > 1 && next.spans.filter(behind).length >= 2) {
    const again = next.ceiling !== null && count >= next.ceiling;
    const holds = Math.floor((count * shown(next.spans)) / KEEP.pace);
    next = {
      ...next,
      ceiling: count,
      wait: again ? Math.min(next.wait * 2, KEEP.retryMost) : KEEP.retry,
      since: 0,
    };
    return to(Math.min(Math.max(holds, 1), count - 1));
  }
  if (next.age < KEEP.calm) return next;
  if (next.ceiling !== null && count >= next.ceiling) {
    next = { ...next, ceiling: null, wait: KEEP.retry };
  }
  const room = next.ceiling === null || count + 1 < next.ceiling || next.since >= next.wait;
  return order.length > count && room ? to(count + 1) : next;
}

/**
 * The span between two readings of the clips that played through it whole: a clip that looped,
 * paused, or is too short to tell a loop from a stall is left out.
 */
function measure(
  from: ReadonlyMap<number, Reading>,
  to: ReadonlyMap<number, Reading>,
  seconds: number,
): Measure | null {
  const span: Measure = { moved: 0, seconds: 0, dropped: 0, due: 0 };
  for (const [id, now] of to) {
    const was = from.get(id);
    if (!was || now.paused || was.paused || now.time < was.time || now.due < was.due) continue;
    if (!Number.isFinite(now.duration) || now.duration * 1000 < 2 * KEEP.span) continue;
    span.moved += now.time - was.time;
    span.seconds += seconds;
    span.dropped += now.dropped - was.dropped;
    span.due += now.due - was.due;
  }
  return span.seconds > 0 ? span : null;
}

function behind(span: Measure) {
  return (
    span.moved / span.seconds < KEEP.pace ||
    (span.due > 0 && span.dropped / span.due >= KEEP.dropped)
  );
}

/** Of the frames the clips were due to show at their pace, the share shown. */
function shown(spans: readonly Measure[]) {
  const sum = (pick: (span: Measure) => number) => spans.reduce((all, one) => all + pick(one), 0);
  const due = sum((span) => span.due);
  return (
    (sum((span) => span.moved) / sum((span) => span.seconds)) *
    (due > 0 ? 1 - sum((span) => span.dropped) / due : 1)
  );
}

/**
 * How many of `order`, the set's clips in play order, play: all at first, fewer while this machine
 * falls behind with them. DECISIONS.md "Several files in the pane".
 */
export function useKeepTime(area: RefObject<HTMLElement | null>, order: readonly number[]) {
  const [limit, setLimit] = useState(Number.POSITIVE_INFINITY);
  const held = useRef(keeper());
  const latest = useRef(order);
  const several = order.length > 1;

  useLayoutEffect(() => {
    latest.current = order;
  });

  useEffect(() => {
    if (!several) return;
    const tick = () => {
      if (document.hidden) {
        held.current = restart(held.current);
        return;
      }
      const ids = latest.current.slice(0, held.current.limit);
      held.current = observe(
        held.current,
        latest.current,
        read(area.current, ids),
        performance.now(),
      );
      setLimit(held.current.limit);
    };
    const timer = setInterval(tick, KEEP.span);
    return () => clearInterval(timer);
  }, [several, area]);

  return limit;
}

function read(area: HTMLElement | null, ids: readonly number[]) {
  const readings = new Map<number, Reading>();
  for (const id of ids) {
    const video = area?.querySelector<HTMLVideoElement>(`[data-file="${id}"] video`);
    if (!video || video.error) continue;
    const quality = video.getVideoPlaybackQuality();
    readings.set(id, {
      time: video.currentTime,
      duration: video.duration,
      dropped: quality.droppedVideoFrames,
      due: quality.totalVideoFrames,
      paused: video.paused,
    });
  }
  return readings;
}

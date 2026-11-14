import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";

import { Pane } from "../app/pane/Pane";
import { PaneDetailProvider } from "../app/pane/pane-detail";
import { addToPane, showInPane } from "../app/pane/pane-store";
import type { ItemDetail } from "../ipc/bindings/ItemDetail";
import { clip, photograph, serveFiles } from "./media";

// Frame rate, and the clips' dropped frames and pace, with several originals in the pane: what
// `pane-set` and `pane-set-playing` are held to. It runs in a timing test, and in a headed browser
// on the dev server by importing this module there. DECISIONS.md "Several files in the pane".

const PHOTO = { width: 6000, height: 4000 };
const VIDEO = { width: 1920, height: 1080 };

/**
 * Of the frames the clips were due to show over a span of the count, how many they dropped, and
 * how far their clocks moved against the window's, on average: 1 keeps time.
 */
export type Span = { dropped: number; due: number; pace: number };

/** Frames a second, the median gap between them, how many came late, and the clips' own frames. */
export type Bench = {
  rate: number;
  median: number;
  late: number;
  intervals: number;
  /** Of the frames the clips were due to show over the whole count, how many they dropped. */
  dropped: number;
  due: number;
  pace: number;
  /** The same, span by span. */
  spans: Span[];
};

/** What the window does while its frames are counted. */
export type Motion =
  /** Nothing moves but the clips. */
  | "still"
  /** The pane is resized every frame, so the set is laid out and drawn again at a new scale. */
  | "resize";

/** A clip already made, played in place of the recorded one. */
export type Clip = { url: string; ms: number; width: number; height: number; ext: string };

export type BenchOptions = {
  /** How many of the files are clips playing; the rest are 6000 × 4000 photographs. */
  clips?: number;
  /** The clip they play; the 1080p recording when none is given. */
  clip?: Clip;
  motion?: Motion;
  /** How long each span of the count lasts. */
  ms?: number;
  /** How many spans the count runs, one after another. */
  spans?: number;
  width?: number;
  height?: number;
};

// Covers the wait before the count, so no clip loops inside it.
const LEAD = 6000;

// The lead and three five-second spans, the timing test's count, so its warm-up records the clip
// the count plays.
const LEAST = LEAD + 15_000;

/** A clip's length, and its object URL once recorded. */
export type Recording = { ms: number; url: Promise<string> };

/**
 * A clip at least as long as asked, recorded `least` long or longer by `record` and kept for the
 * next ask it is long enough for. A recording that fails is not kept.
 */
export function recordings(record: (ms: number) => Promise<string>, least: number) {
  let kept: Recording | undefined;
  return (ms: number): Recording => {
    if (kept && kept.ms >= ms) return kept;
    const length = Math.max(ms, least);
    const made = { ms: length, url: record(length) };
    kept = made;
    made.url.catch(() => {
      if (kept === made) kept = undefined;
    });
    return made;
  };
}

/** One clip for every bench, recorded the first time: it records in real time. */
const movie = recordings((ms) => clip(VIDEO.width, VIDEO.height, ms), LEAST);

function detail(id: number, video: Clip | null, durationMs: number): ItemDetail {
  const shape = video ?? PHOTO;
  const ext = video ? video.ext : "jpg";
  const name = video ? `clip-${id}.${ext}` : `photo-${id}.jpg`;
  return {
    id,
    uuid: `set-${id}`,
    folderId: 6,
    diskName: name,
    ext,
    kind: video ? "video" : "image",
    sizeBytes: 4_000_000,
    mtime: 1_750_000_000,
    width: shape.width,
    height: shape.height,
    durationMs: video ? durationMs : null,
    favorite: false,
    thumb: null,
    scrub: null,
    codec: null,
    bitrate: null,
    frameUs: null,
    capturedAt: null,
    capturedSrc: null,
    addedAt: 1_750_000_000,
    trashedAt: null,
    sourceId: 1,
    sourceKind: "library",
    folders: [{ id: 6, title: "Cairo" }],
    path: `D:\\Pictures\\${name}`,
  };
}

/**
 * Puts `count` originals in a pane `width` by `height`, `clips` of them `clip` spread among the
 * photographs and every one playing, waits until every one is drawn, and times the frames the
 * window draws over `spans` spans of `ms` while `motion` goes on. The clips run longer than the
 * count, so none loops inside it. It replaces the IPC mock and the pane's contents.
 */
export async function benchSet(
  count: number,
  {
    clips = 0,
    clip,
    motion = "still",
    ms = 3000,
    spans = 1,
    width = 1500,
    height = 900,
  }: BenchOptions = {},
): Promise<Bench> {
  const take = clips > 0 && !clip ? movie(LEAD + spans * ms) : null;
  const recorded = take ? await take.url : null;
  const played: Clip | null =
    clip ?? (recorded && take ? { ...VIDEO, url: recorded, ms: take.ms, ext: "webm" } : null);
  if (played && played.ms < LEAD + spans * ms) {
    throw new Error(`a ${played.ms}ms clip would loop inside the count`);
  }
  const isClip = (at: number) =>
    Math.floor(((at + 1) * clips) / count) > Math.floor((at * clips) / count);
  const files = Array.from({ length: count }, (_, at) =>
    detail(at + 1, isClip(at) ? played : null, played?.ms ?? 0),
  );
  const urls: Record<string, string> = {};
  for (const file of files) {
    urls[file.diskName] =
      file.kind === "video" && played
        ? played.url
        : await photograph(PHOTO.width, PHOTO.height, (file.id * 47) % 360);
  }
  const unserve = serveFiles(urls);
  mockIPC(
    (cmd, payload) => {
      if (cmd === "item_detail") {
        const id = (payload as { itemId: number }).itemId;
        return files.find((file) => file.id === id) ?? null;
      }
      if (cmd === "items_detail") {
        const ids = (payload as { itemIds: number[] }).itemIds;
        return ids.map((id) => files.find((file) => file.id === id) ?? null);
      }
      if (cmd === "folder_items") return [];
      return cmd === "item_tags" ? [] : undefined;
    },
    { shouldMockEvents: true },
  );
  const root = document.documentElement;
  const playing = root.style.getPropertyValue("--pane-set-playing");
  if (clips > 0) root.style.setProperty("--pane-set-playing", String(clips));
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;top:0;right:0;z-index:9999;display:flex;flex-direction:column;width:${width}px;height:${height}px;background:var(--color-panel)`;
  document.body.append(host);
  const react = createRoot(host);
  const [first, ...rest] = files.map((file) => file.id);
  showInPane(first ?? 1, null);
  addToPane(rest, null);
  react.render(
    <PaneDetailProvider>
      <Pane />
    </PaneDetailProvider>,
  );
  try {
    const wanted = (kind: string) => files.filter((file) => file.kind === kind).length;
    await until(() => {
      const images = [...host.querySelectorAll<HTMLImageElement>("[data-file] img")];
      const videos = [...host.querySelectorAll<HTMLVideoElement>("[data-file] video")];
      return (
        images.filter((image) => image.complete && image.naturalWidth > 0).length ===
          wanted("image") &&
        videos.filter((video) => video.readyState >= 2).length === wanted("video")
      );
    });
    await Promise.all(
      [...host.querySelectorAll("img")].map((image) => image.decode().catch(() => undefined)),
    );
    const videos = [...host.querySelectorAll<HTMLVideoElement>("[data-file] video")];
    // Settled, so the first decodes are not what is counted: a second, and every clip a second in.
    await frames(1000);
    await until(() => videos.every((one) => one.getVideoPlaybackQuality().totalVideoFrames >= 30));
    type Mark = { at: number; quality: VideoPlaybackQuality[]; clocks: number[] };
    const mark = (): Mark => ({
      at: performance.now(),
      quality: videos.map((one) => one.getVideoPlaybackQuality()),
      clocks: videos.map((one) => one.currentTime),
    });
    const begun = mark();
    const marks = [begun];
    const times = [...begun.clocks];
    let looped = false;
    let start: number | undefined;
    const drawn = await frames(spans * ms, (now) => {
      start ??= now;
      if (motion === "resize") {
        // Down to half the width and back each second: a new scale every frame.
        const swing = (1 + Math.cos((now / 1000) * 2 * Math.PI)) / 2;
        host.style.width = `${Math.round(width * (0.5 + 0.5 * swing))}px`;
      }
      videos.forEach((one, index) => {
        if (one.currentTime < (times[index] ?? 0)) looped = true;
        times[index] = one.currentTime;
      });
      if (now - start >= marks.length * ms && marks.length < spans) marks.push(mark());
    });
    marks.push(mark());
    if (looped) throw new Error("a clip looped inside the count, which its own seam can drop");
    const span = (from: Mark, to: Mark): Span => {
      const total = (pick: (one: VideoPlaybackQuality) => number) =>
        to.quality.reduce(
          (sum, one, index) => sum + pick(one) - pick(from.quality[index] ?? one),
          0,
        );
      const moved = to.clocks.reduce(
        (sum, one, index) => sum + one - (from.clocks[index] ?? one),
        0,
      );
      return {
        dropped: total((one) => one.droppedVideoFrames),
        due: total((one) => one.totalVideoFrames),
        pace: videos.length > 0 ? moved / videos.length / ((to.at - from.at) / 1000) : 1,
      };
    };
    const each = marks.slice(1).map((to, index) => span(marks[index] ?? begun, to));
    const whole = span(begun, marks.at(-1) ?? begun);
    const intervals = drawn.slice(1).map((at, index) => at - (drawn[index] ?? at));
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const late = intervals.filter((gap) => gap > median * 1.5).length;
    const rate = (drawn.length - 1) / (((drawn.at(-1) ?? 0) - (drawn[0] ?? 0)) / 1000);
    return { rate, median, late, intervals: intervals.length, ...whole, spans: each };
  } finally {
    react.unmount();
    host.remove();
    if (playing) root.style.setProperty("--pane-set-playing", playing);
    else root.style.removeProperty("--pane-set-playing");
    showInPane(null);
    unserve();
    for (const url of new Set(Object.values(urls)))
      if (url !== played?.url) URL.revokeObjectURL(url);
  }
}

/** The display's own frame rate, counted over a second with nothing else drawn. */
export async function displayRate() {
  const idle = await frames(1000);
  return (idle.length - 1) / (((idle.at(-1) ?? 0) - (idle[0] ?? 0)) / 1000);
}

/** The time of every frame the window draws over this long, calling `each` at every one. */
export function frames(ms: number, each?: (now: number) => void) {
  return new Promise<number[]>((resolve) => {
    const drawn: number[] = [];
    const step = (now: number) => {
      drawn.push(now);
      each?.(now);
      if (now - (drawn[0] ?? now) < ms) requestAnimationFrame(step);
      else resolve(drawn);
    };
    requestAnimationFrame(step);
  });
}

function until(done: () => boolean, timeout = 60_000) {
  const start = performance.now();
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (done()) resolve();
      else if (performance.now() - start > timeout) {
        const media = [...document.querySelectorAll<HTMLMediaElement>("[data-file] video")];
        const state = media.map((one) => `${one.paused ? "paused" : "playing"} ${one.readyState}`);
        reject(new Error(`the set was never drawn: ${state.join(", ")}`));
      } else setTimeout(check, 50);
    };
    check();
  });
}

import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";

import { Pane } from "../app/pane/Pane";
import { PaneDetailProvider } from "../app/pane/pane-detail";
import { addToPane, showInPane } from "../app/pane/pane-store";
import type { ItemDetail } from "../ipc/bindings/ItemDetail";
import { clip, photograph, serveFiles } from "./media";

// Frame rate with several originals in the pane, which `pane-set` is set from. It runs in a
// timing test, and in a headed browser on the dev server by importing this module there.
// DECISIONS.md "Several files in the pane".

const PHOTO = { width: 6000, height: 4000 };
const VIDEO = { width: 1920, height: 1080 };

/** Frames a second, the median gap between them, how many came late, and the clips' own frames. */
export type Bench = {
  rate: number;
  median: number;
  late: number;
  intervals: number;
  /** Of the frames the clips were due to show over the count, how many they dropped. */
  dropped: number;
  due: number;
};

/** What the window does while its frames are counted. */
export type Motion =
  /** Nothing moves but the clips. */
  | "still"
  /** The pane is resized every frame, so the set is laid out and drawn again at a new scale. */
  | "resize";

export type BenchOptions = {
  /** How many of the files are 1080p clips playing; the rest are 6000 × 4000 photographs. */
  clips?: number;
  motion?: Motion;
  ms?: number;
  width?: number;
  height?: number;
};

function detail(id: number, video: boolean): ItemDetail {
  const shape = video ? VIDEO : PHOTO;
  const name = video ? `clip-${id}.webm` : `photo-${id}.jpg`;
  return {
    id,
    uuid: `set-${id}`,
    folderId: 6,
    diskName: name,
    ext: video ? "webm" : "jpg",
    kind: video ? "video" : "image",
    sizeBytes: 4_000_000,
    mtime: 1_750_000_000,
    width: shape.width,
    height: shape.height,
    durationMs: video ? 2000 : null,
    favorite: false,
    thumb: null,
    scrub: null,
    codec: null,
    bitrate: null,
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
 * Puts `count` originals in a pane `width` by `height`, `clips` of them 1080p clips spread among
 * the photographs and every one playing, waits until every one is drawn, and times the frames the window draws over
 * `ms` while `motion` goes on. It replaces the IPC mock and the pane's contents.
 */
export async function benchSet(
  count: number,
  { clips = 0, motion = "still", ms = 3000, width = 1500, height = 900 }: BenchOptions = {},
): Promise<Bench> {
  const isClip = (at: number) =>
    Math.floor(((at + 1) * clips) / count) > Math.floor((at * clips) / count);
  const files = Array.from({ length: count }, (_, at) => detail(at + 1, isClip(at)));
  const movie = clips > 0 ? await clip(VIDEO.width, VIDEO.height, 2000) : null;
  const urls: Record<string, string> = {};
  for (const file of files) {
    urls[file.diskName] =
      file.kind === "video" && movie
        ? movie
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
    const before = videos.map((one) => one.getVideoPlaybackQuality());
    const drawn = await frames(
      ms,
      motion === "resize"
        ? (now) => {
            // Down to half the width and back each second: a new scale every frame.
            const swing = (1 + Math.cos((now / 1000) * 2 * Math.PI)) / 2;
            host.style.width = `${Math.round(width * (0.5 + 0.5 * swing))}px`;
          }
        : undefined,
    );
    const after = videos.map((one) => one.getVideoPlaybackQuality());
    const total = (pick: (quality: VideoPlaybackQuality) => number) =>
      after.reduce((sum, one, at) => sum + pick(one) - pick(before[at] ?? one), 0);
    const dropped = total((one) => one.droppedVideoFrames);
    const due = total((one) => one.totalVideoFrames);
    const intervals = drawn.slice(1).map((at, index) => at - (drawn[index] ?? at));
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const late = intervals.filter((gap) => gap > median * 1.5).length;
    const rate = (drawn.length - 1) / (((drawn.at(-1) ?? 0) - (drawn[0] ?? 0)) / 1000);
    return { rate, median, late, intervals: intervals.length, dropped, due };
  } finally {
    react.unmount();
    host.remove();
    if (playing) root.style.setProperty("--pane-set-playing", playing);
    else root.style.removeProperty("--pane-set-playing");
    showInPane(null);
    unserve();
    for (const url of new Set(Object.values(urls))) URL.revokeObjectURL(url);
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

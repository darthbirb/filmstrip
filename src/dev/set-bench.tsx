import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";

import { Pane } from "../app/pane/Pane";
import { PaneDetailProvider } from "../app/pane/pane-detail";
import { addToPane, showInPane } from "../app/pane/pane-store";
import type { ItemDetail } from "../ipc/bindings/ItemDetail";
import { clip, photograph, serveFiles } from "./media";

// Frame rate with several originals in the pane, which `pane-set` is set from. It runs in a
// component test, and in a headed browser on the dev server by importing this module there.
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
 * Puts `count` originals in a pane `width` by `height`, every `clipsEvery`th a 1080p clip playing
 * and the rest 6000 × 4000 photographs, waits until every one is drawn, and times the frames the
 * window draws over `ms`. It replaces the IPC mock and the pane's contents.
 */
export async function benchSet(
  count: number,
  clipsEvery: number,
  { ms = 3000, width = 1500, height = 900 } = {},
): Promise<Bench> {
  const files = Array.from({ length: count }, (_, at) =>
    detail(at + 1, clipsEvery > 0 && at % clipsEvery === clipsEvery - 1),
  );
  const movie = await clip(VIDEO.width, VIDEO.height, 2000);
  const urls: Record<string, string> = {};
  for (const file of files) {
    urls[file.diskName] =
      file.kind === "video"
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
      if (cmd === "folder_items") return [];
      return cmd === "item_tags" ? [] : undefined;
    },
    { shouldMockEvents: true },
  );
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;width:${width}px;height:${height}px;background:var(--color-panel)`;
  document.body.append(host);
  const root = createRoot(host);
  const [first, ...rest] = files.map((file) => file.id);
  showInPane(first ?? 1, null);
  addToPane(rest, null);
  root.render(
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
        videos.filter((video) => !video.paused && video.readyState >= 2).length === wanted("video")
      );
    });
    await Promise.all(
      [...host.querySelectorAll("img")].map((image) => image.decode().catch(() => undefined)),
    );
    // A second to settle, so the first decodes are not what is counted.
    await frames(1000);
    const clips = [...host.querySelectorAll<HTMLVideoElement>("[data-file] video")];
    const before = clips.map((one) => one.getVideoPlaybackQuality());
    const drawn = await frames(ms);
    const after = clips.map((one) => one.getVideoPlaybackQuality());
    const count = (pick: (quality: VideoPlaybackQuality) => number) =>
      after.reduce((sum, one, at) => sum + pick(one) - pick(before[at] ?? one), 0);
    const dropped = count((one) => one.droppedVideoFrames);
    const due = count((one) => one.totalVideoFrames);
    const intervals = drawn.slice(1).map((at, index) => at - (drawn[index] ?? at));
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const late = intervals.filter((gap) => gap > median * 1.5).length;
    const rate = (drawn.length - 1) / (((drawn.at(-1) ?? 0) - (drawn[0] ?? 0)) / 1000);
    return { rate, median, late, intervals: intervals.length, dropped, due };
  } finally {
    root.unmount();
    host.remove();
    showInPane(null);
    unserve();
    for (const url of new Set(Object.values(urls))) URL.revokeObjectURL(url);
  }
}

/** The time of every frame the window draws over this long. */
export function frames(ms: number) {
  return new Promise<number[]>((resolve) => {
    const drawn: number[] = [];
    const step = (now: number) => {
      drawn.push(now);
      if (now - (drawn[0] ?? now) < ms) requestAnimationFrame(step);
      else resolve(drawn);
    };
    requestAnimationFrame(step);
  });
}

function until(done: () => boolean, timeout = 30_000) {
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

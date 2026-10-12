import { convertFileSrc } from "@tauri-apps/api/core";
import { type PointerEvent, useState } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { formatElapsed } from "../../lib/format";
import type { Scrubbing } from "../../ui/Thumb";

/** What a video's tile shows with the pointer `at` across it, from 0 at its left edge to 1. */
export function scrubbing(item: ItemRow, at: number): Scrubbing {
  const length = item.durationMs ?? 0;
  const time = formatElapsed(length * at, length);
  const strip = item.scrub;
  if (!strip || strip.frames < 1) return { at, time };
  const cell = Math.min(strip.frames - 1, Math.floor(at * strip.frames));
  return { at, time, frames: { src: convertFileSrc(strip.path), count: strip.frames, cell } };
}

/**
 * A video's tile scrubbed by the pointer across it, left to right; leaving puts the poster back.
 * Its frames are asked for only while it is under the pointer. Components › Scrubbing a video's tile.
 */
export function useScrub(item: ItemRow) {
  const [at, setAt] = useState<number | null>(null);
  if (item.kind !== "video") return { scrub: undefined, handlers: {} };
  const handlers = {
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") return;
      const box = event.currentTarget.getBoundingClientRect();
      if (box.width <= 0) return;
      setAt(Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1));
    },
    onPointerLeave: () => setAt(null),
  };
  return { scrub: at === null ? undefined : scrubbing(item, at), handlers };
}

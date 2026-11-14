import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { BrowserCommand } from "vitest/node";

/**
 * Clips shaped like phone footage, made by the ffmpeg `scripts/fetch-ffmpeg.ps1` puts in
 * `src-tauri/target/tools` while the tests run, and removed after.
 * DECISIONS.md "Several files in the pane".
 */
export type Footage = {
  codec: "h264" | "hevc";
  width: number;
  height: number;
  fps: number;
  /** Megabits a second, about what a phone records at this size and rate. */
  mbps: number;
  seconds: number;
};

const run = promisify(execFile);
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "target");
const folder = join(target, "footage");
const made = new Map<string, Promise<string>>();

function ffmpeg() {
  const found = join(target, "tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (!existsSync(found)) {
    throw new Error(`no ffmpeg at ${found}: run scripts/fetch-ffmpeg.ps1 first`);
  }
  return found;
}

function footageName({ codec, width, height, fps, mbps, seconds }: Footage) {
  return `${codec}-${width}x${height}-${fps}fps-${mbps}mbps-${seconds}s.mp4`;
}

/** The arguments that encode it: a moving test card under fresh grain, so every frame costs bits. */
function footageArgs(footage: Footage, out: string) {
  const { codec, width, height, fps, mbps, seconds } = footage;
  const rate = `${mbps}M`;
  const encoder =
    codec === "h264"
      ? ["-c:v", "libx264", "-profile:v", "high", "-preset", "superfast"]
      : [
          "-c:v",
          "libx265",
          "-tag:v",
          "hvc1",
          "-preset",
          "ultrafast",
          "-x265-params",
          "log-level=error",
        ];
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${width}x${height}:rate=${fps}:duration=${seconds}`,
    "-vf",
    "noise=alls=10:allf=t",
    ...encoder,
    "-b:v",
    rate,
    "-maxrate",
    rate,
    "-bufsize",
    `${mbps * 2}M`,
    "-g",
    String(fps),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    out,
  ];
}

/** Makes the clip once a run and gives the path the test page reads it at. */
export const footage: BrowserCommand<[Footage]> = async (_, wanted) => {
  const name = footageName(wanted);
  let path = made.get(name);
  if (!path) {
    const out = join(folder, name);
    path = mkdir(folder, { recursive: true })
      .then(() => run(ffmpeg(), footageArgs(wanted, out), { timeout: 600_000 }))
      .then(() => `/@fs/${out.replaceAll("\\", "/")}`);
    made.set(name, path);
    path.catch(() => made.delete(name));
  }
  return path;
};

/** Removes every clip made this run. */
export const removeFootage: BrowserCommand<[]> = async () => {
  made.clear();
  await rm(folder, { recursive: true, force: true });
};

declare module "vitest/browser" {
  interface BrowserCommands {
    footage: (wanted: Footage) => Promise<string>;
    removeFootage: () => Promise<void>;
  }
}

// Builds a small library of generated pictures under src-tauri/target/dev-library and registers it
// with a running `tauri dev` over its debug port. DEVELOPMENT.md "Seeing the app".
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..", "src-tauri", "target", "dev-library");

// Each source: its kind, and how many pictures each of its folders holds ("" is the source itself).
const SOURCES = {
  Pictures: {
    kind: "library",
    folders: {
      "": 4,
      "Trips/Cairo": 9,
      "Trips/Lisbon": 12,
      "Trips/Kyoto": 7,
      "Trips/Kyoto/Temples": 5,
      "People/Ana": 8,
      "People/Sam": 6,
      Screenshots: 10,
    },
  },
  Incoming: { kind: "sorting", folders: { "": 14, Phone: 6 } },
  "Old drive": { kind: "library", folders: { Scans: 4 }, unplugged: true },
};

// Landscape, portrait, square, panorama and tall, so the layouts have real shapes to fit.
const SHAPES = [
  [900, 600],
  [600, 900],
  [800, 800],
  [1400, 500],
  [700, 1000],
  [1000, 750],
];

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function hsl(hue, saturation, lightness) {
  const k = (n) => (n + hue / 30) % 12;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n) => lightness - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((value) => Math.round(value * 255));
}

// Made by ffmpeg when it is on PATH: a landscape clip, one recorded sideways, one arriving.
const VIDEOS = [
  {
    file: "Pictures/Trips/Cairo/felucca.mp4",
    seconds: 6,
    size: "640x360",
    at: "2024-06-13T16:05:00Z",
  },
  {
    file: "Pictures/Trips/Cairo/minaret.mp4",
    seconds: 4,
    size: "640x360",
    at: "2024-06-14T08:12:00Z",
    turned: true,
  },
  { file: "Incoming/Phone/clip.mp4", seconds: 3, size: "480x270", at: "2025-01-02T12:00:00Z" },
];

/** An EXIF block holding one DateTimeOriginal, as a camera writes it: `2024:06:12 10:33:21`. */
function exif(taken) {
  const text = Buffer.from(`${taken}\0`, "ascii");
  const out = Buffer.alloc(44 + text.length);
  out.write("II", 0, "ascii");
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(8, 4);
  // The first directory holds one entry, pointing at the EXIF directory at 26.
  out.writeUInt16LE(1, 8);
  out.writeUInt16LE(0x8769, 10);
  out.writeUInt16LE(4, 12);
  out.writeUInt32LE(1, 14);
  out.writeUInt32LE(26, 18);
  // The EXIF directory holds DateTimeOriginal, its text straight after it at 44.
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(0x9003, 28);
  out.writeUInt16LE(2, 30);
  out.writeUInt32LE(text.length, 32);
  out.writeUInt32LE(44, 36);
  text.copy(out, 44);
  return out;
}

/** `YYYY:MM:DD hh:mm:ss`, a few days apart for each picture made. */
function takenAt(n) {
  const at = new Date(Date.UTC(2024, 5, 12, 10, 33, 21) + n * 3 * 86_400_000);
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${at.getUTCFullYear()}:${pad(at.getUTCMonth() + 1)}:${pad(at.getUTCDate())}`;
  return `${date} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
}

function ffmpeg(args) {
  const run = spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-y", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr || run.error}`);
}

/** A test pattern with a creation time; a turned one carries a note to stand it upright. */
function video({ file, seconds, size, at, turned }) {
  const out = join(ROOT, file);
  mkdirSync(join(out, ".."), { recursive: true });
  const plain = turned ? join(ROOT, "unturned.mp4") : out;
  const source = `testsrc2=duration=${seconds}:size=${size}:rate=24`;
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    source,
    "-pix_fmt",
    "yuv420p",
    "-metadata",
    `creation_time=${at}`,
    plain,
  ]);
  if (turned) {
    ffmpeg([
      "-display_rotation",
      "90",
      "-i",
      plain,
      "-c",
      "copy",
      "-metadata",
      `creation_time=${at}`,
      out,
    ]);
    rmSync(plain);
  }
}

/** A diagonal colour wash, as a real PNG, from Node's own zlib, carrying a capture date if given. */
function picture(width, height, hue, taken) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = hsl((hue + (x / width) * 60) % 360, 0.55, 0.25 + 0.45 * (y / height));
      raw.set(rgb, y * stride + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(taken ? [chunk("eXIf", exif(taken))] : []),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

rmSync(ROOT, { recursive: true, force: true });
let made = 0;
for (const [name, source] of Object.entries(SOURCES)) {
  for (const [folder, count] of Object.entries(source.folders)) {
    const dir = join(ROOT, name, folder);
    mkdirSync(dir, { recursive: true });
    const stem = (folder.split("/").at(-1) || name).toLowerCase().replaceAll(" ", "-");
    for (let n = 1; n <= count; n++) {
      const [width, height] = SHAPES[made % SHAPES.length];
      const file = `${stem}-${String(n).padStart(2, "0")}.png`;
      // Screenshots carry no capture date, as real ones don't.
      const taken = folder === "Screenshots" ? undefined : takenAt(made);
      writeFileSync(join(dir, file), picture(width, height, (made * 47) % 360, taken));
      made++;
    }
  }
}
console.log(`${made} pictures written`);

if (spawnSync("ffmpeg", ["-version"]).status === 0) {
  for (const clip of VIDEOS) video(clip);
  console.log(`${VIDEOS.length} videos written`);
} else {
  console.log("ffmpeg is not on PATH, so no videos");
}

let browser;
for (let attempt = 0; attempt < 60 && !browser; attempt++) {
  browser = await chromium.connectOverCDP("http://127.0.0.1:9322").catch(() => undefined);
  if (!browser) await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!browser) throw new Error("start `tauri dev` first: its window was not found on port 9322");

const page = browser.contexts()[0].pages()[0];
const invoke = (cmd, args) =>
  page.evaluate(
    ([cmd, args]) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch((error) => ({ error })),
    [cmd, args],
  );

for (const [name, source] of Object.entries(SOURCES)) {
  const result = await invoke("add_source", { root: join(ROOT, name), kind: source.kind });
  console.log(result?.error ? `${name}: ${result.error.message}` : `${name}: registered`);
}

await invoke("start_index");
for (let waited = 0; waited < 180; waited++) {
  const progress = await invoke("index_progress");
  if (progress.phase === "idle") {
    console.log("indexed:", progress);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

// Indexed while present, then taken away, so it shows as a source that cannot be reached.
for (const [name, source] of Object.entries(SOURCES)) {
  if (source.unplugged) rmSync(join(ROOT, name), { recursive: true, force: true });
}
await page.reload();
process.exit(0);

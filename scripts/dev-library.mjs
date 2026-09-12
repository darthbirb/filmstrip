// Builds a small library of generated pictures under src-tauri/target/dev-library and registers it
// with a running `tauri dev` over its debug port. DEVELOPMENT.md "Seeing the app".
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

/** A diagonal colour wash, as a real PNG, from Node's own zlib. */
function picture(width, height, hue) {
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
      writeFileSync(join(dir, file), picture(width, height, (made * 47) % 360));
      made++;
    }
  }
}
console.log(`${made} pictures written`);

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

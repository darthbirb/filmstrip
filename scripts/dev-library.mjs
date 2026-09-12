// Builds a small library under src-tauri/target/dev-library and registers it with a running
// `tauri dev` over its debug port, so the real app has folders to show. DEVELOPMENT.md "Seeing the app".
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..", "src-tauri", "target", "dev-library");

// Each source: its kind, and how many files each of its folders holds ("" is the source itself).
const SOURCES = {
  Pictures: {
    kind: "library",
    folders: {
      "": 2,
      "Trips/Cairo": 3,
      "Trips/Lisbon": 4,
      "Trips/Kyoto": 3,
      "Trips/Kyoto/Temples": 2,
      "People/Ana": 3,
      "People/Sam": 2,
      Screenshots: 5,
    },
  },
  Incoming: { kind: "sorting", folders: { "": 6, Phone: 3 } },
  "Old drive": { kind: "library", folders: { Scans: 4 }, unplugged: true },
};

rmSync(ROOT, { recursive: true, force: true });
for (const [name, source] of Object.entries(SOURCES)) {
  for (const [folder, count] of Object.entries(source.folders)) {
    const dir = join(ROOT, name, folder);
    mkdirSync(dir, { recursive: true });
    const stem = (folder.split("/").at(-1) || name).toLowerCase().replaceAll(" ", "-");
    for (let n = 1; n <= count; n++) {
      writeFileSync(join(dir, `${stem}-${String(n).padStart(2, "0")}.jpg`), "dev library");
    }
  }
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
console.log("walked:", await invoke("reconcile"));

// Indexed while present, then taken away, so it shows as a source that cannot be reached.
for (const [name, source] of Object.entries(SOURCES)) {
  if (source.unplugged) rmSync(join(ROOT, name), { recursive: true, force: true });
}
await page.reload();
process.exit(0);

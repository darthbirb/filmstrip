import { emit } from "@tauri-apps/api/event";
import { beforeAll, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import type { Progress } from "../../ipc/bindings/Progress";
import { undoLast } from "../../ipc/commands";
import { Grid } from "../grid/Grid";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { openFolders, setOpenFolders } from "../navigation/open-folders";
import { watchWork } from "../navigation/work-store";
import { type Place, setPlace } from "../place";
import { showReport } from "../undo/report-store";
import { watchCopies } from "./copy";
import { ExplorerGhost, useExplorerDrops } from "./drop";

// Against the dev mock: Pictures (D:\Pictures) holds People (5, empty) and Trips (4), Trips holds
// Cairo (6), and Archive is away.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

const DOWNLOADS = [
  "C:\\Users\\Ana\\Downloads\\IMG_5001.jpg",
  "C:\\Users\\Ana\\Downloads\\IMG_5002.jpg",
];

beforeAll(async () => {
  await watchWork();
  await watchCopies();
});

beforeEach(async () => {
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  resetIndex();
  await loadIndex();
  setOpenFolders(new Set());
  openFolders([1, 4]);
  setPlace(CAIRO);
});

function Drops() {
  useExplorerDrops();
  return <ExplorerGhost />;
}

async function renderAll() {
  await page.viewport(1200, 800);
  render(
    <>
      <div style={{ display: "flex", height: 600 }}>
        <nav style={{ width: 260, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflow: "auto" }}>
            <Navigation />
          </div>
          <Foot />
        </nav>
        <div style={{ width: 800 }}>
          <Grid mode="uniform" />
        </div>
      </div>
      <Drops />
    </>,
  );
  await expect.element(row("People 0 of 0")).toBeVisible();
}

const row = (name: string | RegExp) => page.getByRole("treeitem", { name, exact: true });

/** Where Explorer says the pointer is: over an element, in the webview's physical pixels. */
function over(element: Element) {
  const box = element.getBoundingClientRect();
  const scale = window.devicePixelRatio;
  return { x: (box.left + 40) * scale, y: (box.top + box.height / 2) * scale };
}

/** Explorer carries `paths` in over `element` and rests there. */
async function carryOver(paths: string[], element: Element) {
  await emit("tauri://drag-enter", { paths, position: over(element) });
  await emit("tauri://drag-over", { position: over(element) });
}

const ghost = (text: string) => page.getByText(text, { exact: true });

test("files from Explorer over a folder's row say where they go, and letting go copies them there", async () => {
  await renderAll();
  const people = row("People 0 of 0").element();
  await carryOver(DOWNLOADS, people);
  await expect.element(ghost("Copy 2 files to People")).toBeVisible();
  await expect.poll(() => people.className).toContain("inset-ring-plate");

  await recording(async (calls) => {
    await emit("tauri://drag-drop", { paths: DOWNLOADS, position: over(people) });
    await expect
      .poll(() => calls.find(([cmd]) => cmd === "drop_files")?.[1])
      .toEqual({
        folderId: 5,
        paths: DOWNLOADS,
      });
  });
  await expect.element(page.getByText("Copied 2 files to People.")).toBeVisible();
  await expect.element(row("People 2 of 2")).toBeVisible();
  await expect.poll(() => document.body.textContent).not.toContain("Copy 2 files to People");
});

test("a row that will not take them says why, and letting go there copies nothing", async () => {
  await renderAll();
  const cases: [string[], string | RegExp, string][] = [
    [DOWNLOADS, /^Trash /, "Only Delete sends to the Trash"],
    [DOWNLOADS, "Archive offline", "Archive is offline"],
    [["D:\\Pictures\\Trips\\Cairo\\pyramid.jpg"], "Cairo 3 of 3", "Already in Cairo"],
    [["D:\\Pictures\\Trips"], "Cairo 3 of 3", "Trips cannot go inside itself"],
  ];
  await recording(async (calls) => {
    for (const [paths, name, why] of cases) {
      const at = row(name).element();
      await carryOver(paths, at);
      await expect.element(ghost(why)).toBeVisible();
      expect(at.className).not.toContain("inset-ring-plate");
      await emit("tauri://drag-drop", { paths, position: over(at) });
    }
    expect(calls.some(([cmd]) => cmd === "drop_files")).toBe(false);
  });
});

test("a folder's grid takes them as its row does, ringed, and copies into the folder it shows", async () => {
  await renderAll();
  const grid = document.querySelector("[data-drop=grid]");
  if (!grid) throw new Error("no grid");
  const folder = ["C:\\Users\\Ana\\Downloads\\Alexandria"];
  await carryOver(folder, grid);
  await expect.element(ghost("Copy 1 folder to Cairo")).toBeVisible();
  await expect.poll(() => grid.className).toContain("inset-ring-plate");

  await emit("tauri://drag-drop", { paths: folder, position: over(grid) });
  await expect.element(page.getByText("Copied Alexandria to Cairo.")).toBeVisible();
  expect(grid.className).not.toContain("inset-ring-plate");
});

test("a copy under way has its own line at the foot, and its dismiss cancels it", async () => {
  await renderAll();
  const progress: Progress = {
    phase: "idle",
    pending: 0,
    running: 0,
    failed: 0,
    completed: 0,
    copies: [{ jobId: 7, folderId: 5, to: "People", done: 108, whole: 1200 }],
  };
  await emit("job-progress", progress);
  await expect.element(page.getByText("Copying to People…")).toBeVisible();
  await expect.element(page.getByText("9%")).toBeVisible();
  await expect
    .element(page.getByTitle("Copying to People · 1,092 of 1,200 left"))
    .toBeInTheDocument();

  await recording(async (calls) => {
    await page.getByRole("button", { name: "Cancel Copy" }).click();
    expect(calls).toContainEqual(["cancel_copy", { jobId: 7 }]);
  });
  await emit("job-progress", { ...progress, copies: [] });
  await expect.poll(() => document.body.textContent).not.toContain("Copying to People");
});

import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { Grid } from "./Grid";

const SHAPES = [
  [900, 600],
  [600, 900],
  [800, 800],
  [1400, 500],
];

function rows(count: number): ItemRow[] {
  return Array.from({ length: count }, (_, n) => {
    const [width, height] = SHAPES[n % SHAPES.length] as [number, number];
    return {
      id: n + 1,
      uuid: `item-${n}`,
      folderId: 1,
      diskName: `item-${n}.png`,
      ext: "png",
      kind: "image",
      sizeBytes: 1,
      mtime: 0,
      width,
      height,
      durationMs: null,
      favorite: false,
      thumb: null,
    };
  });
}

/** Serves `count` items for the folder, and records every command the grid sends. */
function serve(count: number) {
  const sent: string[] = [];
  mockIPC(
    (cmd) => {
      sent.push(cmd);
      return cmd === "folder_items" ? rows(count) : undefined;
    },
    { shouldMockEvents: true },
  );
  return sent;
}

async function renderGrid(mode: "justified" | "uniform") {
  await page.viewport(1000, 700);
  return render(
    <div style={{ width: 1000, height: 600 }}>
      <Grid mode={mode} />
    </div>,
  );
}

const tiles = () => [...document.querySelectorAll("figure")] as HTMLElement[];
const firstRow = () => {
  const top = tiles()[0]?.style.top;
  return tiles().filter((tile) => tile.style.top === top);
};

beforeEach(() => {
  setPlace({ kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] });
});

afterEach(() => {
  updatePreferences({ tile: undefined });
});

test("justified rows run edge to edge and keep each picture's shape", async () => {
  serve(40);
  await renderGrid("justified");
  await expect.poll(() => tiles().length).toBeGreaterThan(0);

  const row = firstRow();
  const last = row.at(-1) as HTMLElement;
  const right = Number.parseFloat(last.style.left) + Number.parseFloat(last.style.width);
  const scroller = document.querySelector("figure")?.closest(".overflow-auto") as HTMLElement;
  const gap = Number.parseFloat(row[0]?.style.left ?? "0");
  expect(right).toBeCloseTo(scroller.clientWidth - gap, 0);
  const [first] = row;
  expect(
    Number.parseFloat(first?.style.width ?? "0") / Number.parseFloat(first?.style.height ?? "1"),
  ).toBeCloseTo(1.5, 2);
});

test("uniform tiles are square, and a larger size fits fewer to a row", async () => {
  serve(40);
  await renderGrid("uniform");
  await expect.poll(() => tiles().length).toBeGreaterThan(0);
  const [tile] = tiles();
  expect(tile?.style.width).toBe(tile?.style.height);
  const perRow = firstRow().length;

  updatePreferences({ tile: 20 });
  await expect.poll(() => firstRow().length).toBeLessThan(perRow);
});

test("only the rows near the view are drawn, and scrolling draws the rest", async () => {
  serve(2000);
  await renderGrid("uniform");
  await expect.poll(() => tiles().length).toBeGreaterThan(0);
  expect(tiles().length).toBeLessThan(2000);

  const scroller = document.querySelector("figure")?.closest(".overflow-auto") as HTMLElement;
  scroller.scrollTop = scroller.scrollHeight;
  await expect
    .poll(() => tiles().some((tile) => tile.getAttribute("aria-label") === "item-1999.png"))
    .toBe(true);
});

test("a folder with nothing in it says so", async () => {
  serve(0);
  const screen = await renderGrid("justified");
  await expect.element(screen.getByText("No pictures here.")).toBeVisible();
});

test("the grid fetches its items again when background work moves on", async () => {
  const sent = serve(4);
  await renderGrid("justified");
  await expect.poll(() => sent.filter((cmd) => cmd === "folder_items").length).toBe(1);

  await emit("job-progress", { phase: "working", pending: 1, running: 1, failed: 0, completed: 3 });
  await expect.poll(() => sent.filter((cmd) => cmd === "folder_items").length).toBe(2);
});

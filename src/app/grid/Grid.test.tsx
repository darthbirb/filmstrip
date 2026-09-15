import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { getPaneItem, showInPane } from "../pane/pane-store";
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
  showInPane(null);
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
  await expect.poll(() => tiles().some((tile) => tile.title === "item-1999.png")).toBe(true);
});

test("clicking a picture puts it in the pane, and the grid marks which one it is", async () => {
  serve(6);
  const screen = await renderGrid("justified");
  const third = screen.getByRole("button", { name: "item-2.png" });
  await third.click();

  expect(getPaneItem()).toBe(3);
  await expect.element(third).toHaveAttribute("aria-current", "true");
  await screen.getByRole("button", { name: "item-4.png" }).click();
  await expect.element(third).not.toHaveAttribute("aria-current");
});

test("a place with nothing in it says so, and only a folder points to the folders inside it", async () => {
  mockIPC((cmd) => (cmd === "folder_items" || cmd === "sorting_items" ? [] : undefined), {
    shouldMockEvents: true,
  });
  const screen = await renderGrid("justified");
  const note = () => screen.getByText("Folders inside it are in the tree.");
  await expect.element(screen.getByText("No pictures here.")).toBeVisible();
  await expect.element(note()).toBeVisible();

  setPlace({ kind: "sorting" });
  await expect.poll(() => note().elements().length).toBe(0);
  await expect.element(screen.getByText("No pictures here.")).toBeVisible();
});

test("a video's tile writes its length in the corner, and a picture's writes nothing", async () => {
  const [picture, other] = rows(2) as [ItemRow, ItemRow];
  const clip: ItemRow = { ...other, diskName: "clip.mp4", ext: "mp4", kind: "video" };
  mockIPC(
    (cmd) => (cmd === "folder_items" ? [picture, { ...clip, durationMs: 12_000 }] : undefined),
    { shouldMockEvents: true },
  );
  const screen = await renderGrid("justified");
  await expect.element(screen.getByRole("button", { name: "clip.mp4" })).toHaveTextContent("0:12");
  expect(screen.getByRole("button", { name: picture.diskName }).element().textContent).toBe("");
});

test("the grid fetches its items again when background work moves on", async () => {
  const sent = serve(4);
  await renderGrid("justified");
  await expect.poll(() => sent.filter((cmd) => cmd === "folder_items").length).toBe(1);

  await emit("job-progress", { phase: "working", pending: 1, running: 1, failed: 0, completed: 3 });
  await expect.poll(() => sent.filter((cmd) => cmd === "folder_items").length).toBe(2);
});

test("two grids on one page each keep their own layout", async () => {
  serve(12);
  await page.viewport(1000, 700);
  await render(
    <div style={{ display: "flex", width: 1000, height: 600 }}>
      <section aria-label="justified" style={{ width: 500 }}>
        <Grid mode="justified" />
      </section>
      <section aria-label="uniform" style={{ width: 500 }}>
        <Grid mode="uniform" />
      </section>
    </div>,
  );
  const widths = (name: string) =>
    [...document.querySelectorAll(`section[aria-label="${name}"] figure`)].map(
      (tile) => (tile as HTMLElement).style.width,
    );
  await expect.poll(() => widths("justified").length).toBe(12);
  await expect.poll(() => widths("uniform").length).toBe(12);

  expect(new Set(widths("uniform")).size).toBe(1);
  expect(new Set(widths("justified")).size).toBeGreaterThan(1);
});

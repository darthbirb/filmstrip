import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { withoutGlyphs } from "../../dev/words";
import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { showInPane } from "../pane/pane-store";
import { setPlace } from "../place";
import { Grid } from "./Grid";

function video(id: number, frames: boolean): ItemRow {
  return {
    id,
    uuid: `clip-${id}`,
    folderId: 1,
    diskName: `clip-${id}.mp4`,
    ext: "mp4",
    kind: "video",
    sizeBytes: 1,
    mtime: 0,
    width: 1600,
    height: 900,
    durationMs: 72_000,
    favorite: false,
    thumb: `thumbs\\clip-${id}.webp`,
    scrub: frames ? { path: `thumbs\\clip-${id}.frames.webp`, frames: 10 } : null,
  };
}

async function renderGrid(rows: ItemRow[]) {
  mockIPC((cmd) => (cmd === "folder_items" ? rows : undefined), { shouldMockEvents: true });
  await page.viewport(1000, 700);
  return render(
    <div style={{ width: 1000, height: 600 }}>
      <Grid mode="justified" />
    </div>,
  );
}

const strips = () => [...document.querySelectorAll<HTMLImageElement>("[data-scrub-frames]")];

/** Puts the pointer `at` the way across a tile, from 0 at its left edge to 1 at its right. */
async function across(tile: HTMLElement, at: number) {
  const box = tile.getBoundingClientRect();
  await userEvent.hover(tile, { position: { x: box.width * at, y: box.height / 2 } });
}

const internals = (
  window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => string } }
).__TAURI_INTERNALS__;
const drawn = internals.convertFileSrc;

beforeEach(() => {
  setPlace({ kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] });
  showInPane(null);
  // Each path stays itself, so which strip a tile asked for can be read off its source.
  internals.convertFileSrc = (path) => `/assets/${encodeURIComponent(path)}`;
});

afterEach(() => {
  internals.convertFileSrc = drawn;
});

test("the pointer across a video's tile shows the frame and the time under it", async () => {
  const screen = await renderGrid([video(1, true)]);
  const tile = screen.getByRole("button", { name: "clip-1.mp4" });
  await expect.element(tile).toBeVisible();
  expect(withoutGlyphs(tile.element().textContent)).toBe("1:12");

  await across(tile.element() as HTMLElement, 0.38);
  await expect.poll(() => strips().length).toBe(1);
  expect(strips()[0]?.style.getPropertyValue("object-view-box")).toBe("inset(0% 60% 0% 30%)");
  expect(strips()[0]?.src).toContain("clip-1.frames.webp");
  expect(tile.element().textContent).toBe("0:27");

  await across(tile.element() as HTMLElement, 0.99);
  await expect
    .poll(() => strips()[0]?.style.getPropertyValue("object-view-box"))
    .toBe("inset(0% 0% 0% 90%)");
  expect(tile.element().textContent).toBe("1:11");
});

test("leaving the tile puts the poster frame and the length back", async () => {
  const screen = await renderGrid([video(1, true), video(2, true)]);
  const first = screen.getByRole("button", { name: "clip-1.mp4" });
  const second = screen.getByRole("button", { name: "clip-2.mp4" });
  await expect.element(second).toBeVisible();
  await across(first.element() as HTMLElement, 0.5);
  await expect.poll(() => strips().length).toBe(1);

  await across(second.element() as HTMLElement, 0.5);
  await expect.poll(() => strips()[0]?.src).toContain("clip-2.frames.webp");
  expect(strips()).toHaveLength(1);
  expect(withoutGlyphs(first.element().textContent)).toBe("1:12");
});

test("a video without scrub frames says so, and keeps its length", async () => {
  const screen = await renderGrid([video(1, false)]);
  const tile = screen.getByRole("button", { name: "clip-1.mp4" });
  await expect.element(tile).toBeVisible();
  await across(tile.element() as HTMLElement, 0.6);

  await expect.element(screen.getByText("No Preview")).toBeVisible();
  expect(strips()).toHaveLength(0);
  expect(withoutGlyphs(tile.element().textContent)).toBe("No Preview1:12");
});

test("the tile the pane shows keeps its In Pane plate over No Preview", async () => {
  showInPane(1);
  const screen = await renderGrid([video(1, false)]);
  const tile = screen.getByRole("button", { name: "clip-1.mp4" });
  await expect.element(tile).toBeVisible();
  await across(tile.element() as HTMLElement, 0.6);

  await expect.element(screen.getByText("In Pane")).toBeVisible();
  expect(screen.getByText("No Preview").query()).toBeNull();
});

test("frames are asked for by the tile under the pointer and no other", async () => {
  const rows = Array.from({ length: 2_000 }, (_, n) => video(n + 1, true));
  const screen = await renderGrid(rows);
  const tile = screen.getByRole("button", { name: "clip-3.mp4" });
  await expect.element(tile).toBeVisible();
  expect(strips()).toHaveLength(0);

  await across(tile.element() as HTMLElement, 0.2);
  await expect.poll(() => strips().length).toBe(1);
  expect(strips()[0]?.src).toContain("clip-3.frames.webp");
});

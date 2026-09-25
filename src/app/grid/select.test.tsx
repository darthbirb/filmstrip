import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { getPaneItem, showInPane } from "../pane/pane-store";
import { setPlace } from "../place";
import { Grid } from "./Grid";
import { clearChecked, getSelection } from "./selection";

function rows(count: number, folderId = 1): ItemRow[] {
  return Array.from({ length: count }, (_, n) => ({
    id: folderId * 100 + n + 1,
    uuid: `item-${folderId}-${n}`,
    folderId,
    diskName: `item-${n}.png`,
    ext: "png",
    kind: "image",
    sizeBytes: 1,
    mtime: 0,
    width: 800,
    height: 600,
    durationMs: null,
    favorite: false,
    thumb: null,
  }));
}

let held: Record<number, ItemRow[]> = {};

function serve() {
  held = { 1: rows(6, 1), 2: rows(3, 2) };
  mockIPC(
    (cmd, args) =>
      cmd === "folder_items" ? held[(args as { folderId: number }).folderId] : undefined,
    { shouldMockEvents: true },
  );
}

const inFolder = (id: number) =>
  setPlace({ kind: "folder", sourceId: 1, path: [{ id, title: `Folder ${id}` }] });

async function renderGrid() {
  await page.viewport(1000, 700);
  render(
    <div style={{ width: 1000, height: 600 }}>
      <Grid mode="uniform" />
    </div>,
  );
  await expect.element(page.getByRole("button", { name: "item-5.png" })).toBeVisible();
}

const tile = (n: number) => page.getByRole("button", { name: `item-${n}.png` });
const box = (n: number) => page.getByRole("checkbox", { name: `Check item-${n}.png` });
const shownBoxes = () =>
  [...document.querySelectorAll<HTMLInputElement>("figure input[type=checkbox]")].filter(
    (input) => getComputedStyle(input.parentElement as HTMLElement).opacity === "1",
  ).length;

beforeEach(() => {
  serve();
  inFolder(1);
  clearChecked();
  showInPane(101, null);
});

test("the box checks a file and the pane keeps what it shows; then every tile shows its box", async () => {
  await renderGrid();
  expect(shownBoxes()).toBe(0);

  await userEvent.click(box(2));
  await expect.element(box(2)).toBeChecked();
  expect(getSelection().ids).toEqual([103]);
  expect(getPaneItem()).toBe(101);
  await expect.poll(shownBoxes).toBe(6);

  await userEvent.click(box(2));
  await expect.element(box(2)).not.toBeChecked();
  // Only the box under the pointer is left.
  await expect.poll(shownBoxes).toBe(1);
});

test("a plain click still shows the picture and checks nothing", async () => {
  await renderGrid();
  await userEvent.click(tile(3));
  expect(getPaneItem()).toBe(104);
  expect(getSelection().ids).toEqual([]);
});

test("Ctrl+click toggles and Shift+click takes the range, and neither moves the pane", async () => {
  await renderGrid();
  await userEvent.click(tile(1), { modifiers: ["Control"] });
  await userEvent.click(tile(4), { modifiers: ["Shift"] });
  expect(getSelection().ids).toEqual([102, 103, 104, 105]);
  await userEvent.click(tile(3), { modifiers: ["Control"] });
  expect(getSelection().ids).toEqual([102, 103, 105]);
  expect(getPaneItem()).toBe(101);
  await expect.element(box(1)).toBeChecked();
  await expect.element(box(3)).not.toBeChecked();
});

test("with nothing checked, Shift+click runs from the file in the pane", async () => {
  await renderGrid();
  await userEvent.click(tile(2), { modifiers: ["Shift"] });
  expect(getSelection().ids).toEqual([101, 102, 103]);
});

test("going to another place clears the set, and coming back finds nothing checked", async () => {
  await renderGrid();
  await userEvent.click(box(0));
  inFolder(2);
  expect(getSelection().ids).toEqual([]);
  inFolder(1);
  await expect.element(box(0)).not.toBeChecked();
});

test("a folder renamed under you is the same place, and keeps its set", async () => {
  await renderGrid();
  await userEvent.click(box(0));
  setPlace({ kind: "folder", sourceId: 1, path: [{ id: 1, title: "Renamed" }] });
  expect(getSelection().ids).toEqual([101]);
});

test("a checked file that leaves the grid leaves the set", async () => {
  await renderGrid();
  await userEvent.click(box(0));
  await userEvent.click(box(1));
  held[1] = (held[1] ?? []).filter((row) => row.id !== 102);
  await emit("job-progress");
  await expect.poll(() => getSelection().ids).toEqual([101]);
});

import { mockIPC } from "@tauri-apps/api/mocks";
import { useState } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { Grid } from "../grid/Grid";
import { DEFAULT_LAYOUT } from "../grid/layout";
import { setPlace } from "../place";
import { getPreferences, updatePreferences, usePreferences } from "../preferences";
import { Settings } from "./Settings";

const SHAPES = [
  [900, 600],
  [600, 900],
  [1400, 500],
];

const items: ItemRow[] = Array.from({ length: 12 }, (_, n) => {
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

/** Settings over the grid, joined by the saved preferences as the app joins them. */
function Harness() {
  const [open, setOpen] = useState(true);
  const layout = usePreferences().layout ?? DEFAULT_LAYOUT;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <div style={{ width: 1000, height: 600 }}>
        <Grid mode={layout} />
      </div>
      <Settings open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const widths = () =>
  [...document.querySelectorAll("figure")].map((tile) => (tile as HTMLElement).style.width);

beforeEach(() => {
  setPlace({ kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] });
  mockIPC((cmd) => (cmd === "folder_items" ? items : undefined), { shouldMockEvents: true });
  updatePreferences({ layout: undefined, scale: 1 });
});

afterEach(() => {
  updatePreferences({ scale: 1 });
});

test("the grid's layout is chosen in Settings, and the grid follows and remembers it", async () => {
  await page.viewport(1100, 700);
  const screen = await render(<Harness />);
  await expect.poll(() => widths().length).toBe(12);
  expect(new Set(widths()).size).toBeGreaterThan(1);

  await screen.getByRole("button", { name: "Grid layout: Rows" }).click();
  await screen.getByRole("option", { name: "Squares" }).click();
  await expect.poll(() => new Set(widths()).size).toBe(1);
  expect(getPreferences().layout).toBe("uniform");
});

test("the interface size is one of five named steps, and choosing one scales everything", async () => {
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Interface size: 100%" }).click();
  const sizes = screen.getByRole("listbox", { name: "Interface size" }).getByRole("option");
  expect(sizes.elements().map((option) => option.textContent)).toEqual([
    "80%",
    "100%",
    "125%",
    "150%",
    "200%",
  ]);

  await screen.getByRole("option", { name: "125%" }).click();
  expect(document.documentElement.style.fontSize).toBe("125%");
  expect(getPreferences().scale).toBe(1.25);
});

test("Settings is modal, and Escape or a click on the backdrop puts it away", async () => {
  await page.viewport(1100, 700);
  const screen = await render(<Harness />);
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  await expect.element(dialog).toBeVisible();
  const element = dialog.element() as HTMLDialogElement;
  expect(element.matches(":modal")).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => element.open).toBe(false);

  await screen.getByRole("button", { name: "Open settings" }).click();
  await expect.element(dialog).toBeVisible();
  await userEvent.click(dialog, { position: { x: -40, y: -40 } });
  await expect.poll(() => element.open).toBe(false);
});

test("Escape in an open menu closes the menu and leaves Settings open", async () => {
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Grid layout: Rows" }).click();
  const menu = screen.getByRole("listbox", { name: "Grid layout" });
  await expect.element(menu).toBeVisible();
  const opened = menu.element();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => opened.matches(":popover-open")).toBe(false);
  const dialog = screen.getByRole("dialog", { name: "Settings" }).element() as HTMLDialogElement;
  expect(dialog.open).toBe(true);
});

test("the filter narrows Settings to the rows that match, and says when none do", async () => {
  const screen = await render(<Harness />);
  const filter = screen.getByRole("searchbox", { name: "Find a setting" });
  await filter.fill("layout");
  await expect.element(screen.getByText("Grid layout", { exact: true })).toBeVisible();
  expect(screen.getByText("Interface size", { exact: true }).elements()).toHaveLength(0);

  await filter.fill("nothing like it");
  await expect.element(screen.getByText(/No setting matches/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Appearance" }).elements()).toHaveLength(0);
});

test("Settings fits the smallest window at the largest interface size", async () => {
  await page.viewport(640, 480);
  updatePreferences({ scale: 2 });
  const screen = await render(<Harness />);
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  await expect.element(dialog).toBeVisible();
  const box = dialog.element().getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(640);
  expect(box.bottom).toBeLessThanOrEqual(480);
});

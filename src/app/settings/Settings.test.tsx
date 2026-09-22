import { mockIPC } from "@tauri-apps/api/mocks";
import { useState } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { Grid } from "../grid/Grid";
import { DEFAULT_LAYOUT } from "../grid/layout";
import { loadIndex, resetIndex } from "../navigation/index-store";
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

const SOURCES = [
  {
    id: 1,
    root: "D:Pictures",
    title: "Pictures",
    kind: "library" as const,
    addedAt: 0,
    rootFolderId: 1,
    reachable: true,
    itemCount: 6,
    totalBytes: 0,
  },
  {
    id: 2,
    root: "E:Archive",
    title: "Archive",
    kind: "library" as const,
    addedAt: 0,
    rootFolderId: 2,
    reachable: false,
    itemCount: 0,
    totalBytes: 0,
  },
];

/** Settings open on Sources, against two folders: one read, one on a drive that is away. */
async function onSources(removed: number[] = []) {
  mockIPC(
    (cmd, payload) => {
      if (cmd === "list_sources") return SOURCES;
      if (cmd === "folder_items") return items;
      if (cmd === "remove_source") removed.push((payload as { id: number }).id);
      return undefined;
    },
    { shouldMockEvents: true },
  );
  resetIndex();
  await loadIndex();
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Sources" }).click();
  return screen.getByRole("region", { name: "Sources" });
}

// These replace the dev mock's library, so they stay last.
test("Sources lists every folder read, and an offline one keeps remove but loses reveal", async () => {
  const section = await onSources();

  // Its path, its count and its kind: what only a source has.
  await expect.element(section.getByText("D:Pictures")).toBeVisible();
  await expect.element(section.getByText("6 items")).toBeVisible();
  await expect.element(section.getByRole("radio", { name: "Library" }).first()).toBeChecked();

  await expect.element(section.getByRole("button", { name: "Reveal Pictures" })).toBeVisible();
  await expect.element(section.getByRole("button", { name: "Remove Pictures" })).toBeVisible();
  // The folder is not there to open, so the reveal goes and the remove stays.
  expect(section.getByRole("button", { name: "Reveal Archive" }).elements()).toHaveLength(0);
  await expect.element(section.getByRole("button", { name: "Remove Archive" })).toBeVisible();
});

test("a source's name is a field where it stands, with no button of its own", async () => {
  const section = await onSources();

  expect(section.getByRole("button", { name: /^Rename/ }).elements()).toHaveLength(0);
  await section.getByRole("button", { name: "Pictures" }).click();
  await expect.element(section.getByRole("textbox", { name: "Rename Pictures" })).toBeVisible();
});

test("the section explains nothing: the rows are the count, and the warning waits for remove", async () => {
  const section = await onSources();
  await expect.element(section.getByText("D:Pictures")).toBeVisible();
  expect(section.getByText(/Added here/).elements()).toHaveLength(0);
  expect(section.getByText(/drops what Filmstrip knows/).elements()).toHaveLength(0);
});

test("pressing remove asks on the row, and Cancel or Escape puts the row back", async () => {
  const removed: number[] = [];
  const section = await onSources(removed);
  await section.getByRole("button", { name: "Remove Pictures" }).click();

  const question = section.getByRole("group", { name: "Remove Pictures?" });
  await expect.element(question.getByText(/The folder stays on disk\./)).toBeVisible();
  // The name and the count stay; the kind, reveal and remove give up their space.
  await expect.element(question.getByText("Pictures", { exact: true })).toBeVisible();
  await expect.element(question.getByText("6 items")).toBeVisible();
  expect(section.getByRole("button", { name: "Reveal Pictures" }).elements()).toHaveLength(0);
  await expect.element(question.getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(removed).toEqual([]);

  await question.getByRole("button", { name: "Cancel" }).click();
  await expect.element(section.getByRole("button", { name: "Remove Pictures" })).toBeVisible();

  await section.getByRole("button", { name: "Remove Pictures" }).click();
  await expect.element(section.getByRole("group", { name: "Remove Pictures?" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(section.getByRole("button", { name: "Remove Pictures" })).toBeVisible();
  // Escape answered the question, so it does not also put Settings away.
  await expect.element(section).toBeVisible();
  expect(removed).toEqual([]);
});

test("Remove source is the answer that removes it", async () => {
  const removed: number[] = [];
  const section = await onSources(removed);
  await section.getByRole("button", { name: "Remove Pictures" }).click();
  await section.getByRole("button", { name: "Remove source" }).click();
  await expect.poll(() => removed).toEqual([1]);
});

test("Sources sits under Your library, and its caption is its name", async () => {
  const section = await onSources();
  await expect
    .element(section.getByRole("heading", { name: "Sources", exact: true }))
    .toBeVisible();
  // A group's heading, then the name of each section under it, in the order the rail draws them.
  const rail = [...document.querySelectorAll("dialog nav > p, dialog nav button .truncate")].map(
    (entry) => entry.textContent,
  );
  expect(rail.indexOf("Your library")).toBeGreaterThan(rail.indexOf("Appearance"));
  expect(rail.indexOf("Sources")).toBeGreaterThan(rail.indexOf("Your library"));
});

import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import { clipboardFiles, copyItems, folderItems, undoLast } from "../../ipc/commands";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { openFolders, setOpenFolders } from "../navigation/open-folders";
import { readClipboard, resetClipboard } from "../paste/clipboard";
import { type Place, setPlace } from "../place";
import { Grid } from "./Grid";

// Against the dev mock: Pictures holds cover.jpg, People (5, empty) and Trips (4), Trips holds
// Cairo (6, three files); Incoming (2) is the one sorting source, holding two.

const PICTURES = { id: 1, title: "Pictures" };
const TRIPS = { id: 4, title: "Trips" };
const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [PICTURES, TRIPS, { id: 6, title: "Cairo" }],
};
const PEOPLE: Place = { kind: "folder", sourceId: 1, path: [PICTURES, { id: 5, title: "People" }] };

beforeEach(async () => {
  while (await undoLast()) {}
  setNews(null);
  resetIndex();
  await loadIndex();
  setOpenFolders(new Set());
  openFolders([1, 4]);
  await copyItems([]);
  resetClipboard();
  await readClipboard();
});

async function renderAt(place: Place) {
  setPlace(place);
  await page.viewport(1200, 800);
  render(
    <div style={{ display: "flex", height: 600 }}>
      <nav style={{ width: 260, overflow: "auto" }}>
        <Navigation />
      </nav>
      <div style={{ width: 800 }}>
        <Grid mode="uniform" />
      </div>
    </div>,
  );
  await expect.element(page.getByRole("treeitem", { name: /^Sorting Box / })).toBeVisible();
}

function grid() {
  const element = document.querySelector<HTMLElement>("[data-drop=grid]");
  if (!element) throw new Error("no grid");
  return element;
}

const menu = () => page.getByRole("menu");

/** The open menu's heading and the labels of its rows, read without their glyphs. */
function read() {
  const open = menu().element();
  return {
    heading: open.querySelector("p")?.textContent ?? null,
    rows: [...open.querySelectorAll("[role=menuitem]")].map((one) =>
      one.textContent?.replace(/[-]/g, "").trim(),
    ),
  };
}

/** A right-click on the grid's own ground, under the last row of tiles. */
async function rightClickGround() {
  const at = grid();
  await userEvent.click(at, {
    button: "right",
    position: { x: at.clientWidth - 24, y: at.clientHeight - 24 },
  });
}

async function copyCover() {
  const [cover] = await folderItems(1);
  await copyItems([cover?.id ?? 0]);
  expect(await clipboardFiles()).toEqual({ files: 1, folders: 0 });
  await readClipboard();
}

test("the ground opens the place's own menu under its name, the rows its row has, and pastes there", async () => {
  await copyCover();
  await renderAt(CAIRO);
  await expect.element(page.getByRole("button", { name: "pyramid.jpg" })).toBeVisible();

  await page.getByRole("treeitem", { name: /^Cairo / }).click({ button: "right" });
  await expect.element(menu()).toBeVisible();
  const row = read();
  await userEvent.keyboard("{Escape}");

  await rightClickGround();
  await expect.element(menu()).toBeVisible();
  expect(read()).toEqual({ heading: "Cairo", rows: row.rows });
  expect(row.rows.slice(0, 2)).toEqual(["New Folder", "Paste 1 File"]);

  await recording(async (calls) => {
    await page.getByRole("menuitem", { name: "Paste 1 File" }).click();
    await expect.poll(() => calls).toContainEqual(["paste_files", { folderId: 6 }]);
  });
});

test("a source's grid opens the source's menu under the source's name", async () => {
  await renderAt({ kind: "folder", sourceId: 1, path: [PICTURES] });
  await expect.element(page.getByRole("button", { name: "cover.jpg" })).toBeVisible();
  await rightClickGround();
  await expect.element(menu()).toBeVisible();
  const { heading, rows } = read();
  expect(heading).toBe("Pictures");
  expect(rows).toContain("Search in Source");
  expect(rows.at(-1)).toBe("Remove Source");
  expect(rows).not.toContain("Paste 1 File");
});

test("a right-click on a tile is still the tile's", async () => {
  await copyCover();
  await renderAt(CAIRO);
  await page.getByRole("button", { name: "pyramid.jpg" }).click({ button: "right" });
  await expect.element(menu()).toBeVisible();
  expect(menu().element().getAttribute("aria-label")).toBe("pyramid.jpg");
  expect(read().rows).not.toContain("New Folder");
});

test("the Sorting Box's ground has Paste alone, and only while the clipboard holds files", async () => {
  await renderAt({ kind: "sorting" });
  await expect.poll(() => document.querySelector("[data-item]")).not.toBeNull();
  await rightClickGround();
  expect(document.querySelector("[role=menu]")).toBeNull();

  await copyCover();
  await rightClickGround();
  await expect.element(menu()).toBeVisible();
  expect(read()).toEqual({ heading: "Sorting Box", rows: ["Paste 1 File"] });
  await recording(async (calls) => {
    await page.getByRole("menuitem", { name: "Paste 1 File" }).click();
    await expect.poll(() => calls).toContainEqual(["paste_files", { folderId: 2 }]);
  });
});

test("the Trash opens nothing on its ground", async () => {
  await copyCover();
  await renderAt({ kind: "trash" });
  await rightClickGround();
  expect(document.querySelector("[role=menu]")).toBeNull();
  expect(grid().hasAttribute("tabindex")).toBe(false);
});

test("a search opens nothing on its ground", async () => {
  await copyCover();
  await renderAt({ kind: "search", query: "cairo", back: null });
  await rightClickGround();
  expect(document.querySelector("[role=menu]")).toBeNull();
  expect(grid().hasAttribute("tabindex")).toBe(false);
});

test("the menu key on the focused grid opens it against the grid's corner", async () => {
  await copyCover();
  await renderAt(CAIRO);
  await expect.element(page.getByRole("button", { name: "pyramid.jpg" })).toBeVisible();
  const at = grid();
  await userEvent.click(at, { position: { x: at.clientWidth - 24, y: at.clientHeight - 24 } });
  expect(document.activeElement).toBe(at);
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  await expect.element(menu()).toBeVisible();
  expect(read().heading).toBe("Cairo");
  const box = at.getBoundingClientRect();
  const open = menu().element().getBoundingClientRect();
  expect(open.left).toBeGreaterThan(box.left);
  expect(open.top).toBeGreaterThan(box.top);
  expect(open.top).toBeLessThan(box.top + 64);

  await userEvent.keyboard("{Escape}");
  expect(document.activeElement).toBe(at);
});

test("an empty folder's grid is a tab stop of its own, so the keyboard reaches its menu", async () => {
  await copyCover();
  await renderAt(PEOPLE);
  await expect.element(page.getByText("This Folder Is Empty")).toBeVisible();
  expect(grid().tabIndex).toBe(0);
  grid().focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  await expect.element(menu()).toBeVisible();
  expect(read().heading).toBe("People");
  expect(read().rows.slice(0, 2)).toEqual(["New Folder", "Paste 1 File"]);
});

test("Rename from the ground puts the folder's row in its field, opening the folders above it", async () => {
  setOpenFolders(new Set());
  await renderAt(CAIRO);
  expect(document.querySelector("[data-row=folder-6]")).toBeNull();
  await rightClickGround();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect.element(page.getByRole("textbox", { name: "Rename Cairo" })).toHaveFocus();
});

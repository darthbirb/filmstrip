import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { recording } from "../../dev/recording";
import { withoutGlyphs } from "../../dev/words";
import { folderItems, trashItems, undoLast } from "../../ipc/commands";
import { formatBytes } from "../../lib/format";
import { setFavourites } from "../favourites";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { MovePickerHost } from "../pane/move-picker";
import { getPaneItem, showInPane } from "../pane/pane-store";
import { type Place, setPlace } from "../place";
import { showReport } from "../undo/report-store";
import { Grid } from "./Grid";
import { SelectionBar } from "./SelectionBar";
import { clearChecked, getSelection } from "./selection";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg, 2.4 MB each.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

beforeEach(async () => {
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  resetIndex();
  await loadIndex();
  setPlace(CAIRO);
  clearChecked();
  showInPane(null);
  // Through the app's own store, which remembers what was set before the index reads it again.
  setFavourites(
    (await folderItems(6)).map((row) => row.id),
    false,
  );
});

async function renderGrid(width = 900) {
  await page.viewport(1200, 800);
  render(
    <>
      <div style={{ display: "flex", flexDirection: "column", width, height: 600 }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Grid mode="uniform" />
        </div>
        <SelectionBar />
      </div>
      <MovePickerHost />
    </>,
  );
  await expect.element(page.getByRole("button", { name: "sphinx.jpg" })).toBeVisible();
}

const box = (name: string) => page.getByRole("checkbox", { name: `Check ${name}` });
const bar = () => page.getByRole("toolbar", { name: "Selection" });
// The bar draws its line twice, once out of sight to measure it; the one on screen is the last.
const said = (text: string) => bar().getByText(text, { exact: true }).last();
// A glyph is a character of its own, from the font's private area; the words are the rest.
const words = (element: Element) =>
  element.getAttribute("aria-label") ?? withoutGlyphs(element.textContent);
const idOf = async (name: string) =>
  (await folderItems(6)).find((row) => row.diskName === name)?.id ?? -1;

test("checking files brings the bar, with their count and size, and × puts it away", async () => {
  await renderGrid();
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(box("sphinx.jpg"));

  await expect.element(said("2 Files")).toBeVisible();
  await expect.element(said(formatBytes(4_800_000))).toBeVisible();
  await expect.element(bar().getByRole("button", { name: "Delete 2 Files" })).toBeVisible();

  await userEvent.click(bar().getByRole("button", { name: "Clear Selection" }));
  expect(getSelection().ids).toEqual([]);
  // It folds away, and the grid has its height back.
  const folds = () =>
    document
      .querySelector("[aria-label=Selection]")
      ?.closest("[data-open]")
      ?.getAttribute("data-open");
  await expect.poll(folds).toBe("false");
});

test("Select All on the bar takes every file in the place", async () => {
  await renderGrid();
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(bar().getByRole("button", { name: "Select All" }));
  await expect.element(said("3 Files")).toBeVisible();
});

test("Move to… moves the whole set, and the files that went leave it", async () => {
  await renderGrid();
  const ids = [await idOf("pyramid.jpg"), await idOf("sphinx.jpg")];
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(box("sphinx.jpg"));
  await recording(async (calls) => {
    await userEvent.click(bar().getByRole("button", { name: "Move to…" }));
    await userEvent.click(page.getByRole("option", { name: /^Trips/ }));
    await expect
      .poll(() => calls.find(([cmd]) => cmd === "move_items")?.[1])
      .toEqual({
        itemIds: ids,
        folderId: 4,
      });
  });
  await expect.poll(() => getSelection().ids).toEqual([]);
});

test("Favourite on a mixed set makes every one a favourite, then offers to take it off all", async () => {
  await renderGrid();
  const [pyramid, sphinx] = [await idOf("pyramid.jpg"), await idOf("sphinx.jpg")];
  setFavourites([pyramid], true);
  await expect
    .poll(async () => (await folderItems(6)).find((row) => row.id === pyramid)?.favorite)
    .toBe(true);
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(box("sphinx.jpg"));
  await recording(async (calls) => {
    await userEvent.click(bar().getByRole("button", { name: "Favourite", exact: true }));
    expect(calls.find(([cmd]) => cmd === "set_item_favorite")?.[1]).toEqual({
      itemIds: [pyramid, sphinx],
      favorite: true,
    });
  });
  await expect.element(bar().getByRole("button", { name: "Remove Favourite" })).toBeVisible();
});

test("Copy puts the whole set on the clipboard", async () => {
  await renderGrid();
  const ids = [await idOf("sphinx.jpg"), await idOf("felucca.mp4")];
  await userEvent.click(box("sphinx.jpg"));
  await userEvent.click(box("felucca.mp4"));
  await recording(async (calls) => {
    await userEvent.click(bar().getByRole("button", { name: "Copy" }));
    expect(calls.find(([cmd]) => cmd === "copy_items")?.[1]).toEqual({ itemIds: ids });
  });
});

test("deleting a set the pane was showing part of moves the pane past the last one gone", async () => {
  await renderGrid();
  showInPane(await idOf("felucca.mp4"), CAIRO);
  await userEvent.click(box("felucca.mp4"));
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(bar().getByRole("button", { name: "Delete 2 Files" }));
  const sphinx = await idOf("sphinx.jpg");
  await expect.poll(getPaneItem).toBe(sphinx);
  await expect.poll(() => getSelection().ids).toEqual([]);
});

test("in the Trash the bar holds the way back and nothing else", async () => {
  const ids = [await idOf("pyramid.jpg"), await idOf("sphinx.jpg")];
  await trashItems(ids);
  setPlace({ kind: "trash" });
  await renderGrid();
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(box("sphinx.jpg"));

  await expect.element(bar().getByRole("button", { name: "Restore to…" })).toBeVisible();
  expect(
    bar()
      .getByRole("button", { name: /Favourite|Copy|Delete|Move to/ })
      .elements(),
  ).toEqual([]);
  await recording(async (calls) => {
    await userEvent.click(bar().getByRole("button", { name: "Restore", exact: true }));
    await expect
      .poll(() => calls.find(([cmd]) => cmd === "restore_items")?.[1])
      .toEqual({
        itemIds: ids,
        folderId: null,
      });
  });
});

test("at the grid's narrowest the count, Move to… and × stay, and the rest wait behind More", async () => {
  await renderGrid(320);
  await userEvent.click(box("felucca.mp4"));
  await userEvent.keyboard("{Control>}a{/Control}");

  await expect.element(said("3 Files")).toBeVisible();
  await expect.element(bar().getByRole("button", { name: "More" }).last()).toBeVisible();
  const shown = bar()
    .getByRole("button")
    .elements()
    .filter((button) => !button.closest("[inert]"))
    .map(words);
  expect(shown).toEqual(["Move to…", "More", "Clear Selection"]);

  await userEvent.click(bar().getByRole("button", { name: "More" }).last());
  const rows = page.getByRole("menuitem").elements().map(words);
  expect(rows).toEqual(["Select All", "Favourite", "Copy", "Delete 3 Files"]);
});

const tile = (name: string) => page.getByRole("button", { name, exact: true });
const menuRows = () => page.getByRole("menuitem").elements().map(words);

test("right-clicking a checked tile opens the set's menu, counted, with the verbs a set has", async () => {
  await renderGrid();
  const ids = [await idOf("pyramid.jpg"), await idOf("sphinx.jpg")];
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(box("sphinx.jpg"));
  await userEvent.click(tile("sphinx.jpg"), { button: "right" });

  await expect.element(page.getByRole("menu", { name: "2 Files" })).toBeVisible();
  expect(menuRows()).toEqual(["Favourite", "Move to…", "Copy", "Delete 2 Files"]);
  await recording(async (calls) => {
    await userEvent.click(page.getByRole("menuitem", { name: "Delete 2 Files" }));
    await expect
      .poll(() => calls.find(([cmd]) => cmd === "trash_items")?.[1])
      .toEqual({ itemIds: ids });
  });
});

test("right-clicking a tile with no check opens its own menu, and the set stays checked", async () => {
  await renderGrid();
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(tile("felucca.mp4"), { button: "right" });

  await expect.element(page.getByRole("menu", { name: "felucca.mp4" })).toBeVisible();
  expect(menuRows()[0]).toBe("Full Screen");
  expect(getSelection().ids).toEqual([await idOf("pyramid.jpg")]);
});

test("in the Trash the set's menu holds the way back under its count", async () => {
  await trashItems([await idOf("pyramid.jpg"), await idOf("sphinx.jpg")]);
  setPlace({ kind: "trash" });
  await renderGrid();
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(box("sphinx.jpg"));
  await userEvent.click(tile("pyramid.jpg"), { button: "right" });

  await expect.element(page.getByRole("menu", { name: "2 Files" })).toBeVisible();
  expect(menuRows()).toEqual(["Restore", "Restore to…"]);
});

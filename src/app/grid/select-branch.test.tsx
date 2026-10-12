import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import type { FolderNode } from "../../ipc/bindings/FolderNode";
import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { folderItems, moveItems, undoLast } from "../../ipc/commands";
import { libraryChanged } from "../library";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { getPlace, type Place, setPlace } from "../place";
import { Grid } from "./Grid";
import { SelectionBar } from "./SelectionBar";
import { clearChecked, getSelection } from "./selection";

// Against the dev mock: Pictures holds People, empty, and Trips, which holds two files of its own
// and Cairo's three below it; Archive cannot be reached.

const PICTURES: Place = { kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] };

beforeEach(async () => {
  while (await undoLast()) {}
  setPlace(PICTURES);
  clearChecked();
  resetIndex();
  await loadIndex();
  await page.viewport(1300, 800);
});

function Harness() {
  return (
    <div style={{ display: "flex", width: 1200, height: 700 }}>
      <nav style={{ width: 280 }}>
        <Navigation />
      </nav>
      <div style={{ display: "flex", flexDirection: "column", width: 900 }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Grid mode="uniform" />
        </div>
        <SelectionBar />
      </div>
    </div>
  );
}

type Screen = Awaited<ReturnType<typeof render>>;

async function selectInside(screen: Screen, row: string, name: string) {
  await screen.getByRole("treeitem", { name: row }).click({ button: "right" });
  const menu = screen.getByRole("menu", { name });
  await expect.element(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Select Everything Inside" }).click();
}

async function openPictures(screen: Screen) {
  await screen.getByRole("treeitem", { name: "Pictures 1 of 6" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(screen.getByRole("treeitem", { name: "Trips 2 of 5" })).toBeVisible();
}

const where = () => {
  const place = getPlace();
  return place?.kind === "folder" ? place.path.map((crumb) => crumb.title).join("/") : null;
};
const bar = () => page.getByRole("toolbar", { name: "Selection" });
const count = (text: string) => bar().getByText(text, { exact: true }).last();
const box = (name: string) => page.getByRole("checkbox", { name: `Check ${name}` });

test("Select Everything Inside opens the folder and checks its whole branch, counted in the bar", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await selectInside(screen, "Trips 2 of 5", "Trips");

  expect(where()).toBe("Pictures/Trips");
  await expect.element(count("5 Files")).toBeVisible();
  const branch = (await folderItems(4, true)).map((row) => row.id);
  expect(branch).toHaveLength(5);
  expect(getSelection().ids).toEqual(branch);
  // The grid still lists Trips' own two, and both are checked; Cairo's three are counted.
  await expect.element(box("boarding-pass.png")).toBeChecked();
  await expect.element(box("hotel.jpg")).toBeChecked();
  expect(page.getByRole("button", { name: "pyramid.jpg" }).elements()).toHaveLength(0);
});

test("unchecking a tile and Select All keep the branch below the grid checked", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await selectInside(screen, "Trips 2 of 5", "Trips");
  await expect.element(count("5 Files")).toBeVisible();

  await box("hotel.jpg").click();
  await expect.element(count("4 Files")).toBeVisible();
  await bar().getByRole("button", { name: "Select All" }).click();
  await expect.element(count("5 Files")).toBeVisible();
  await userEvent.keyboard("{Control>}a{/Control}");
  await expect.element(count("5 Files")).toBeVisible();
});

test("an empty folder opens with nothing checked", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await selectInside(screen, "People 0 of 0", "People");
  expect(where()).toBe("Pictures/People");
  await expect.poll(() => getSelection().ids).toEqual([]);
  expect(bar().elements()).toHaveLength(0);
});

test("a file that leaves the branch leaves the set, and going elsewhere clears it", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await selectInside(screen, "Trips 2 of 5", "Trips");
  await expect.element(count("5 Files")).toBeVisible();

  const pyramid = (await folderItems(6)).find((row) => row.diskName === "pyramid.jpg");
  await moveItems([pyramid?.id ?? -1], 5);
  await libraryChanged();
  await expect.element(count("4 Files")).toBeVisible();
  expect(getSelection().ids).not.toContain(pyramid?.id);

  await screen.getByRole("treeitem", { name: /^People/ }).click();
  expect(getSelection().ids).toEqual([]);
});

test("a folder on a drive that is away is checked from what the index holds", async () => {
  const old: FolderNode = {
    id: 99,
    title: "Old",
    childCount: 0,
    itemCount: 2,
    allCount: 2,
    favorite: false,
  };
  const kept = (await folderItems(6)).map((row): ItemRow => ({ ...row, folderId: 99 }));
  await recording(
    async () => {
      resetIndex();
      await loadIndex();
      const screen = await render(<Harness />);
      const archive = screen.getByRole("treeitem", { name: "Archive offline" });
      await archive.click();
      await userEvent.keyboard("{ArrowRight}");
      await selectInside(screen, "Old 2 of 2", "Old");
      expect(where()).toBe("Archive/Old");
      await expect.element(count("3 Files")).toBeVisible();
    },
    (cmd, args) => {
      const { folderId, deep } = (args ?? {}) as { folderId?: number; deep?: boolean };
      if (cmd === "folder_children" && folderId === 3) return [old];
      if (cmd === "folder_items" && folderId === 99) return deep ? kept : [];
      if (cmd === "folder_item_ids" && folderId === 99)
        return deep ? kept.map((row) => row.id) : [];
      return undefined;
    },
  );
});

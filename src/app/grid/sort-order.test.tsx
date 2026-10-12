import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { folderItems } from "../../ipc/commands";
import { Pane } from "../pane/Pane";
import { PaneDetailProvider } from "../pane/pane-detail";
import { showInPane } from "../pane/pane-store";
import { type Place, setPlace } from "../place";
import { getPreferences, updatePreferences } from "../preferences";
import { Grid } from "./Grid";
import { SortOrder } from "./SortOrder";
import { TileSize } from "./TileSize";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg, taken a minute
// apart in that order, newest first, all the same size; only felucca has a length.

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
  await page.viewport(1200, 800);
  updatePreferences({ sort: undefined });
  setPlace(CAIRO);
});

function Harness() {
  return (
    <PaneDetailProvider>
      <div className="@container flex items-center gap-2" style={{ width: 700 }}>
        <SortOrder />
        <TileSize />
      </div>
      <div style={{ display: "flex", width: 1100, height: 600 }}>
        <div style={{ width: 700, height: 600 }}>
          <Grid mode="uniform" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
          <Pane />
        </div>
      </div>
    </PaneDetailProvider>
  );
}

const tiles = () =>
  [...document.querySelectorAll("figure > button[aria-label]")]
    .sort((a, b) => {
      const at = (tile: Element) => tile.getBoundingClientRect();
      return at(a).top - at(b).top || at(a).left - at(b).left;
    })
    .map((tile) => tile.getAttribute("aria-label"));

const frames = () =>
  [...document.querySelectorAll('[role="option"][aria-posinset]')]
    .sort(
      (a, b) => Number(a.getAttribute("aria-posinset")) - Number(b.getAttribute("aria-posinset")),
    )
    .map((frame) => frame.getAttribute("aria-label"));

const menuOpen = () => document.querySelector(":popover-open") !== null;

const sortButton = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole("button", { name: /^Sort: / });

test("a folder runs newest taken first, and Reverse turns the grid and the filmstrip over", async () => {
  const pyramid = (await folderItems(6)).find((row) => row.diskName === "pyramid.jpg");
  showInPane(pyramid?.id ?? -1, CAIRO);
  const screen = await render(<Harness />);

  const sort = sortButton(screen);
  await expect.element(sort).toHaveAccessibleName("Sort: Date Taken");
  await expect.element(sort).toHaveAttribute("title", "Sort · Date Taken, Newest First");
  await expect.poll(tiles).toEqual(["felucca.mp4", "pyramid.jpg", "sphinx.jpg"]);
  await expect.poll(frames).toEqual(["felucca.mp4", "pyramid.jpg", "sphinx.jpg"]);

  await screen.getByRole("button", { name: "Reverse · Oldest First" }).click();
  await expect.poll(tiles).toEqual(["sphinx.jpg", "pyramid.jpg", "felucca.mp4"]);
  await expect.poll(frames).toEqual(["sphinx.jpg", "pyramid.jpg", "felucca.mp4"]);
  await expect.element(sort).toHaveAttribute("title", "Sort · Date Taken, Oldest First");
  await expect
    .element(screen.getByRole("button", { name: "Reverse · Newest First" }))
    .toBeEnabled();
  expect(getPreferences().sort?.folder).toEqual({ key: "taken", dir: "asc", seed: 0 });
});

test("the menu lists the five keys, and a key picked starts the way it reads first", async () => {
  updatePreferences({ sort: { folder: { key: "taken", dir: "asc", seed: 0 } } });
  const screen = await render(<Harness />);
  await sortButton(screen).click();

  const menu = screen.getByRole("listbox", { name: "Sort" });
  expect(
    menu
      .getByRole("option")
      .elements()
      .map((option) => option.textContent),
  ).toEqual(["Date Taken", "Date Added", "Size", "Length", "Random"]);
  expect(screen.getByRole("button", { name: /Shuffle/ }).elements()).toHaveLength(0);

  await screen.getByRole("option", { name: "Length" }).click();
  await expect.poll(menuOpen).toBe(false);
  await expect.element(sortButton(screen)).toHaveAttribute("title", "Sort · Length, Longest First");
  await expect.poll(tiles).toEqual(["felucca.mp4", "sphinx.jpg", "pyramid.jpg"]);

  await screen.getByRole("button", { name: "Reverse · Shortest First" }).click();
  await expect.poll(tiles).toEqual(["felucca.mp4", "pyramid.jpg", "sphinx.jpg"]);
});

test("Random disables Reverse in place, and its order holds until Shuffle draws another", async () => {
  const screen = await render(<Harness />);
  await sortButton(screen).click();
  await screen.getByRole("option", { name: "Random" }).click();

  await expect.element(sortButton(screen)).toHaveAttribute("title", "Sort · Random");
  await expect
    .element(screen.getByRole("button", { name: "Reverse · a random order has no direction" }))
    .toBeDisabled();
  const drawn = getPreferences().sort?.folder;
  const order = (await folderItems(6, drawn)).map((row) => row.diskName);
  await expect.poll(tiles).toEqual(order);

  setPlace({ kind: "sorting" });
  await expect.poll(tiles).toEqual(["DSC_0001.jpg", "DSC_0002.jpg", "clip.mp4"]);
  setPlace(CAIRO);
  await expect.poll(tiles).toEqual(order);
  expect(getPreferences().sort?.folder).toEqual(drawn);

  await sortButton(screen).click();
  const shuffle = screen.getByRole("button", { name: "Shuffle a new order" });
  await expect.element(shuffle).toBeVisible();
  await shuffle.click();
  await expect.poll(menuOpen).toBe(false);
  const reshuffled = getPreferences().sort?.folder;
  expect(reshuffled?.key).toBe("random");
  expect(reshuffled?.seed).not.toBe(drawn?.seed);
  const next = (await folderItems(6, reshuffled)).map((row) => row.diskName);
  await expect.poll(tiles).toEqual(next);
});

test("each kind of place keeps the order last chosen in it, and the Trash has none", async () => {
  const screen = await render(<Harness />);
  await sortButton(screen).click();
  await screen.getByRole("option", { name: "Size" }).click();
  await expect.element(sortButton(screen)).toHaveAccessibleName("Sort: Size");

  setPlace({ kind: "sorting" });
  await expect.element(sortButton(screen)).toHaveAccessibleName("Sort: Date Taken");
  await sortButton(screen).click();
  await screen.getByRole("option", { name: "Date Added" }).click();
  await screen.getByRole("button", { name: "Reverse · Oldest First" }).click();
  await expect
    .element(sortButton(screen))
    .toHaveAttribute("title", "Sort · Date Added, Oldest First");

  setPlace({ kind: "search", query: "cairo", back: CAIRO });
  await expect.element(sortButton(screen)).toHaveAccessibleName("Sort: Date Taken");
  setPlace(CAIRO);
  await expect.element(sortButton(screen)).toHaveAccessibleName("Sort: Size");
  setPlace({ kind: "sorting" });
  await expect.element(sortButton(screen)).toHaveAccessibleName("Sort: Date Added");

  setPlace({ kind: "trash" });
  await expect.element(screen.getByRole("button", { name: "Tile Size: Medium" })).toBeVisible();
  expect(screen.getByRole("button", { name: /^Sort: / }).elements()).toHaveLength(0);
  expect(screen.getByRole("button", { name: /^Reverse/ }).elements()).toHaveLength(0);
});

test("as the header narrows the tile size gives up its word first, then the sort", async () => {
  const screen = await render(
    <div className="@container flex items-center gap-2" style={{ width: "40rem" }}>
      <SortOrder />
      <TileSize />
    </div>,
  );
  const header = screen.container.firstElementChild as HTMLElement;
  const shows = (word: string) =>
    screen.getByRole("button").getByText(word).element().getBoundingClientRect().width > 2;
  expect([shows("Date Taken"), shows("Medium")]).toEqual([true, true]);

  header.style.width = "28rem";
  await expect.poll(() => [shows("Date Taken"), shows("Medium")]).toEqual([true, false]);
  header.style.width = "20rem";
  await expect.poll(() => [shows("Date Taken"), shows("Medium")]).toEqual([false, false]);
  await expect.element(sortButton(screen)).toHaveAccessibleName("Sort: Date Taken");
  await expect
    .element(screen.getByRole("button", { name: "Tile Size: Medium" }))
    .toBeInTheDocument();
});

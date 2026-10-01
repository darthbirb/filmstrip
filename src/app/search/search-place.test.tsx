import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import { folderItems, trashItems, undoLast } from "../../ipc/commands";
import { Grid } from "../grid/Grid";
import { placeItems } from "../grid/place-items";
import { SelectionBar } from "../grid/SelectionBar";
import { clearChecked } from "../grid/selection";
import { Breadcrumb } from "../navigation/Breadcrumb";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { selectedRowId } from "../navigation/shared";
import { getPlace, type Place, setPlace } from "../place";
import { useSearchKeys } from "./keys";
import { resetSearches } from "./results";

// Against the dev mock: Pictures › Trips holds Cairo, whose files are felucca.mp4, pyramid.jpg
// and sphinx.jpg; Trips itself holds boarding-pass.png and hotel.jpg.

const TRIPS: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
  ],
};

const searching = (query: string): Place => ({ kind: "search", query, back: TRIPS });

beforeEach(async () => {
  while (await undoLast()) {}
  resetSearches();
  resetIndex();
  await loadIndex();
  clearChecked();
  setPlace(TRIPS);
});

function Keys() {
  useSearchKeys();
  return null;
}

async function renderPlace() {
  await page.viewport(1200, 800);
  return render(
    <div style={{ display: "flex", flexDirection: "column", width: 1000, height: 700 }}>
      <Keys />
      <Breadcrumb />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Grid mode="uniform" />
      </div>
      <SelectionBar />
    </div>,
  );
}

const box = (element: Element) => element.getBoundingClientRect();

test("a search's folders stand before its files, each under its heading, and a card goes into its folder", async () => {
  setPlace(searching("path:Pictures/Trips cairo"));
  const screen = await renderPlace();
  const folders = screen.getByRole("heading", { name: "Folders · 1" });
  const files = screen.getByRole("heading", { name: "Files · 3" });
  await expect.element(files).toBeVisible();
  const card = screen.getByRole("button", { name: /^Cairo/ });
  await expect.element(card).toHaveAttribute("title", "Open Cairo");
  await expect.element(card.getByText("in Pictures / Trips")).toBeVisible();
  await expect.element(card.getByText("Name Cairo", { exact: true })).toBeVisible();
  // Its count is navigation's: its own files, then all of it.
  expect(card.element().querySelector(".rounded-badge [aria-hidden]")?.textContent).toBe("3/3");

  const pyramid = screen.getByRole("button", { name: "pyramid.jpg" });
  await expect.element(pyramid).toBeVisible();
  const tile = pyramid.element();
  expect(box(folders.element()).bottom).toBeLessThanOrEqual(box(card.element()).top);
  expect(box(card.element()).bottom).toBeLessThanOrEqual(box(files.element()).top);
  expect(box(files.element()).bottom).toBeLessThanOrEqual(box(tile).top);
  const caption = tile.closest("figure")?.querySelector("figcaption");
  expect(caption?.textContent).toBe("Cairo");
  expect(caption?.getAttribute("title")).toBe("Pictures › Trips › Cairo");

  await card.click();
  expect(getPlace()).toEqual({
    kind: "folder",
    sourceId: 1,
    path: [
      { id: 1, title: "Pictures" },
      { id: 4, title: "Trips" },
      { id: 6, title: "Cairo" },
    ],
  });
});

test("a card's glass asks the same question inside its folder, in place of the old scope", async () => {
  setPlace(searching("path:Pictures cairo"));
  const screen = await renderPlace();
  const glass = screen.getByRole("button", { name: "Search in Cairo" });
  await expect.element(glass).toHaveAttribute("title", "Search in Folder");
  await glass.click();
  await expect.poll(() => getPlace()).toEqual(searching("path:Pictures/Trips/Cairo cairo"));
});

test("the header names the search by its terms, counts what it found, and goes back", async () => {
  setPlace(searching("path:Pictures/Trips cairo"));
  const screen = await renderPlace();
  const header = screen.getByRole("heading", { level: 2 });
  await expect.element(header.getByText("1 folder · 3 files", { exact: true })).toBeVisible();
  const scope = header.getByTitle("Pictures / Trips");
  await expect.element(scope).toBeVisible();
  expect(withoutGlyphs(scope.element().textContent)).toBe("Trips");
  await expect.element(header.getByText("cairo", { exact: true })).toBeVisible();

  await screen.getByRole("button", { name: "Back to Trips · Escape" }).click();
  expect(getPlace()).toEqual(TRIPS);
});

test("Escape goes back once nothing checked is left to clear", async () => {
  setPlace(searching("path:Pictures/Trips cairo"));
  const screen = await renderPlace();
  await expect.element(screen.getByRole("button", { name: "pyramid.jpg" })).toBeVisible();
  await screen.getByRole("checkbox", { name: "Check pyramid.jpg" }).click();
  await userEvent.keyboard("{Escape}");
  expect(getPlace()?.kind).toBe("search");
  await userEvent.keyboard("{Escape}");
  expect(getPlace()).toEqual(TRIPS);
});

test("Search Everywhere asks again without the scope", async () => {
  setPlace(searching("path:Pictures/Trips hotel"));
  const screen = await renderPlace();
  await expect.element(screen.getByRole("button", { name: "hotel.jpg" })).toBeVisible();
  await screen.getByRole("button", { name: "Search Everywhere" }).click();
  expect(getPlace()).toEqual(searching("hotel"));
});

test("a search that finds only folders says no files, and one that finds nothing says where it looked", async () => {
  setPlace(searching("path:Pictures people"));
  const screen = await renderPlace();
  await expect.element(screen.getByRole("button", { name: /^People/ })).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { level: 2 }).getByText("1 folder · no files"))
    .toBeVisible();
  expect(screen.getByRole("heading", { name: /^Files/ }).elements()).toHaveLength(0);

  setPlace(searching("path:Pictures/Trips/Cairo giza dawn"));
  await expect.element(screen.getByText("Nothing Matched")).toBeVisible();
  await expect
    .element(screen.getByText(/No file in Cairo matches/))
    .toHaveTextContent("No file in Cairo matches giza dawn.");
  expect(screen.getByRole("button", { name: "Search Everywhere" }).elements()).toHaveLength(2);

  // Searched everywhere already, there is nowhere wider to go, and it says so.
  setPlace(searching("giza dawn"));
  await expect
    .element(screen.getByText(/No file anywhere matches/))
    .toHaveTextContent("No file anywhere matches giza dawn.");
  expect(screen.getByRole("button", { name: "Search Everywhere" }).elements()).toHaveLength(0);
});

test("a trashed file among results says where it came from and goes only by Restore", async () => {
  const [felucca] = await folderItems(6);
  await trashItems([felucca?.id ?? -1]);
  setPlace(searching("is:trashed"));
  const screen = await renderPlace();
  const tile = screen.getByRole("button", { name: "felucca.mp4" });
  await expect.element(tile).toBeVisible();
  const caption = tile.element().closest("figure")?.querySelector("figcaption");
  expect(caption?.textContent).toContain("from Cairo");

  await screen.getByRole("checkbox", { name: "Check felucca.mp4" }).click();
  const bar = screen.getByRole("toolbar", { name: "Selection" });
  await expect.element(bar.getByText("Restore", { exact: true }).last()).toBeVisible();
  expect(bar.getByText("Move to…", { exact: true }).elements()).toHaveLength(0);
});

test("no row stands for a search, and its files are the list the pane steps through", async () => {
  const place = searching("path:Pictures/Trips cairo");
  expect(selectedRowId(place)).toBeNull();
  const names = (await placeItems(place)).map((row) => row.diskName);
  expect(names).toEqual(["felucca.mp4", "pyramid.jpg", "sphinx.jpg"]);
});

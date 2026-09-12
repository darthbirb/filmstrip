import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { getPlace, setPlace } from "../place";
import { Breadcrumb } from "./Breadcrumb";
import { DrillNav } from "./DrillNav";
import { loadIndex, resetIndex } from "./index-store";
import { PlacesNav } from "./PlacesNav";
import { TreeNav } from "./TreeNav";

// These run against the dev mock: Pictures holds People and Trips › Cairo; Incoming is a
// sorting source holding three items; Archive cannot be reached.
const titles = () => {
  const place = getPlace();
  return place?.kind === "folder" ? place.path.map((crumb) => crumb.title) : place?.kind;
};

beforeEach(async () => {
  resetIndex();
  setPlace(null);
  await loadIndex();
});

test.each([
  ["tree", TreeNav],
  ["places", PlacesNav],
])(
  "%s: shows the Sorting Box with its count, every library source, and the Trash",
  async (_, Nav) => {
    const screen = await render(<Nav />);
    await expect.element(screen.getByRole("treeitem", { name: "Sorting Box 3" })).toBeVisible();
    await expect.element(screen.getByRole("treeitem", { name: "Pictures" })).toBeVisible();
    await expect.element(screen.getByRole("treeitem", { name: "Archive offline" })).toBeVisible();
    await expect.element(screen.getByRole("treeitem", { name: "Trash" })).toBeVisible();
  },
);

test("tree: a source opens in place, and choosing a folder goes there", async () => {
  const screen = await render(<TreeNav />);
  const row = (name: string) => screen.getByRole("treeitem", { name });
  await expect.poll(() => row("Pictures").element().getAttribute("aria-expanded")).toBe("false");

  await row("Pictures").click();
  await userEvent.keyboard("{ArrowRight}");
  await row("Trips").click();
  expect(titles()).toEqual(["Pictures", "Trips"]);
  await userEvent.keyboard("{ArrowRight}");
  await row("Cairo").click();
  expect(titles()).toEqual(["Pictures", "Trips", "Cairo"]);
  await expect.element(row("Cairo")).toHaveAttribute("aria-selected", "true");
});

test("places: choosing a source lists its folders underneath", async () => {
  const screen = await render(<PlacesNav />);
  const folders = screen.getByRole("tree", { name: "Folders in Pictures" });
  await expect.element(folders.getByRole("treeitem", { name: "Trips" })).toBeVisible();

  await folders.getByRole("treeitem", { name: "Trips" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await folders.getByRole("treeitem", { name: "Cairo" }).click();
  expect(titles()).toEqual(["Pictures", "Trips", "Cairo"]);

  await screen.getByRole("treeitem", { name: "Sorting Box 3" }).click();
  expect(titles()).toBe("sorting");
  expect(screen.getByRole("tree", { name: "Folders in Pictures" }).elements()).toHaveLength(0);
});

test("drill: opens inside the chosen folder, and the back row climbs to the places", async () => {
  const screen = await render(<DrillNav />);
  const row = (name: string) => screen.getByRole("treeitem", { name });
  await expect.element(row("Trips")).toBeVisible();

  await row("Trips").click();
  expect(titles()).toEqual(["Pictures", "Trips"]);
  await expect.element(row("Cairo")).toBeVisible();

  await row("Pictures").click();
  expect(titles()).toEqual(["Pictures"]);
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(row("Sorting Box 3")).toBeVisible();
  await expect.element(row("Archive offline")).toBeVisible();
  await expect.element(row("Trash")).toBeVisible();
  expect(titles()).toEqual(["Pictures"]);
});

test("the breadcrumb goes back up to any folder on the path", async () => {
  setPlace({
    kind: "folder",
    sourceId: 1,
    path: [
      { id: 1, title: "Pictures" },
      { id: 4, title: "Trips" },
      { id: 6, title: "Cairo" },
    ],
  });
  const screen = await render(<Breadcrumb />);
  await expect.element(screen.getByText("Cairo")).toHaveAttribute("aria-current", "location");

  await screen.getByRole("button", { name: "Pictures" }).click();
  expect(titles()).toEqual(["Pictures"]);
});

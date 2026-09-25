import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { setFolderFavorite, undoLast } from "../../ipc/commands";
import { getPlace, type Place, setPlace } from "../place";
import { DeleteQuestion, resetDeleteQuestion } from "./delete-folder";
import { loadIndex, resetIndex } from "./index-store";
import { Navigation } from "./Navigation";
import { Rail } from "./Rail";

// Against the dev mock: Pictures holds People, empty, and Trips, whose two files and Cairo's
// three are its own; Archive cannot be reached.

const PICTURES: Place = { kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] };

beforeEach(async () => {
  while (await undoLast()) {}
  for (const id of [1, 3, 4, 5, 6]) await setFolderFavorite(id, false);
  resetDeleteQuestion();
  setPlace(PICTURES);
  resetIndex();
  await loadIndex();
});

type Screen = Awaited<ReturnType<typeof render>>;

async function choose(screen: Screen, row: string, name: string, verb: string) {
  await screen.getByRole("treeitem", { name: row, exact: true }).click({ button: "right" });
  const menu = screen.getByRole("menu", { name });
  await expect.element(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: verb }).click();
}

const rows = (screen: Screen) =>
  screen
    .getByRole("treeitem")
    .elements()
    .map((row) => row.getAttribute("aria-label"));

test("Favourite on a folder's menu gives it a row of its own, between the app's places and the sources", async () => {
  const screen = await render(<Navigation />);
  await screen.getByRole("treeitem", { name: "Pictures" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await choose(screen, "Trips 2", "Trips", "Favourite");

  await expect
    .poll(() => rows(screen))
    .toEqual([
      "Sorting Box 3",
      "Trash",
      "Trips 2",
      "Pictures",
      "People",
      "Trips 2",
      "Archive offline",
    ]);
  const favourite = screen.getByRole("treeitem").elements()[2];
  // Its parent says which Trips; a rule stands above the group, and another above the sources.
  expect(favourite?.getAttribute("aria-description")).toBe("Pictures");
  expect(favourite?.previousElementSibling?.getAttribute("aria-hidden")).toBe("true");

  // The same menu on the favourite's own row, reading what pressing it now does.
  await screen.getByRole("treeitem", { name: "Trips 2", exact: true }).nth(0).click({
    button: "right",
  });
  await screen.getByRole("menuitem", { name: "Remove Favourite" }).click();
  await expect.poll(() => rows(screen).filter((row) => row === "Trips 2")).toHaveLength(1);
});

test("choosing a favourite goes there, and both of its rows wear the plate without the tree opening", async () => {
  await setFolderFavorite(6, true);
  resetIndex();
  await loadIndex();
  const screen = await render(<Navigation />);
  const favourite = screen.getByRole("treeitem", { name: "Cairo 3" });
  await favourite.click();

  const place = getPlace();
  expect(place?.kind === "folder" && place.path.map((crumb) => crumb.title)).toEqual([
    "Pictures",
    "Trips",
    "Cairo",
  ]);
  await expect.element(favourite).toHaveAttribute("aria-current", "location");
  expect(rows(screen)).not.toContain("People");

  await screen.getByRole("treeitem", { name: "Pictures" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await screen.getByRole("treeitem", { name: "Trips 2", exact: true }).click();
  await userEvent.keyboard("{ArrowRight}");
  await screen.getByRole("treeitem", { name: "Cairo 3" }).nth(1).click();
  await expect
    .element(screen.getByRole("treeitem", { name: "Cairo 3" }).nth(0))
    .toHaveAttribute("aria-current", "location");
});

test("a source's favourite names no parent and counts nothing, and one that is away is muted", async () => {
  await setFolderFavorite(3, true);
  await setFolderFavorite(1, true);
  resetIndex();
  await loadIndex();
  const screen = await render(<Navigation />);
  await expect.poll(() => rows(screen).slice(2, 4)).toEqual(["Archive offline", "Pictures"]);
  const archive = screen.getByRole("treeitem").elements()[2];
  expect(archive?.getAttribute("aria-description")).toBeNull();
});

test("a favourite deleted leaves the group, and undoing the delete brings it back", async () => {
  await setFolderFavorite(5, true);
  resetIndex();
  await loadIndex();
  const screen = await render(
    <>
      <Navigation />
      <DeleteQuestion />
    </>,
  );
  await expect.element(screen.getByRole("treeitem", { name: "People", exact: true })).toBeVisible();
  await choose(screen, "People", "People", "Delete");
  await expect.poll(() => rows(screen)).not.toContain("People");

  await undoLast();
  resetIndex();
  await loadIndex();
  await expect.poll(() => rows(screen)).toContain("People");
});

test("folded, navigation keeps the app's own places and no favourites", async () => {
  await setFolderFavorite(6, true);
  resetIndex();
  await loadIndex();
  const screen = await render(<Rail />);
  await expect.element(screen.getByRole("button", { name: "Trash" })).toBeVisible();
  expect(screen.getByRole("button").elements()).toHaveLength(2);
});

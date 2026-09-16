import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { loadIndex, resetIndex } from "../navigation/index-store";
import { getPlace, type Place, setPlace } from "../place";
import { EmptyPlace } from "./EmptyPlace";

// Against the dev mock: Pictures holds People and Trips, People holds nothing, Archive is offline.
const PICTURES: Place = { kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] };

beforeEach(async () => {
  resetIndex();
  setPlace(null);
  await loadIndex();
});

test("the app's own two places say what their emptiness means", async () => {
  const sorting = await render(<EmptyPlace place={{ kind: "sorting" }} />);
  await expect.element(sorting.getByText("Nothing To Sort")).toBeVisible();
  await expect.element(sorting.getByText(/Everything that came in has been filed/)).toBeVisible();

  const trash = await render(<EmptyPlace place={{ kind: "trash" }} />);
  await expect.element(trash.getByText("Trash Is Empty")).toBeVisible();
});

test("a folder of folders lists them, and choosing one goes there", async () => {
  const screen = await render(<EmptyPlace place={PICTURES} />);
  await expect.element(screen.getByText("No Pictures Here")).toBeVisible();
  await expect
    .element(screen.getByText("Pictures holds 2 folders and no loose files."))
    .toBeVisible();
  // A folder with nothing of its own carries no count, exactly as its row in the tree carries no pill.
  await expect.element(screen.getByRole("button", { name: "People" })).toBeVisible();

  await screen.getByRole("button", { name: "Trips 2" }).click();
  const place = getPlace();
  expect(place?.kind === "folder" && place.path.map((crumb) => crumb.title)).toEqual([
    "Pictures",
    "Trips",
  ]);
});

test("a folder holding nothing at all names itself", async () => {
  const screen = await render(
    <EmptyPlace
      place={{ kind: "folder", sourceId: 1, path: [...PICTURES.path, { id: 5, title: "People" }] }}
    />,
  );
  await expect.element(screen.getByText("This Folder Is Empty")).toBeVisible();
  await expect
    .element(screen.getByText("Nothing is in People, on disk or in the index."))
    .toBeVisible();
});

test("a source that cannot be reached says so, not that it is empty", async () => {
  const screen = await render(
    <EmptyPlace place={{ kind: "folder", sourceId: 3, path: [{ id: 3, title: "Archive" }] }} />,
  );
  await expect.element(screen.getByText("Archive Is Offline")).toBeVisible();
  await expect.element(screen.getByText(/cannot reach it/)).toBeVisible();
});

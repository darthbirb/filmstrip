import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { kindsAdded } from "../../dev/kinds-added";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { getPlace, type Place, setPlace } from "../place";
import { EmptyPlace, OfflinePlace } from "./EmptyPlace";

// Against the dev mock: Pictures holds People and Trips, People holds nothing, Archive is offline.
const PICTURES: Place = { kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] };

beforeEach(async () => {
  resetIndex();
  setPlace(null);
  await loadIndex();
});

/** The lines an empty place draws: its title, then a line only where it holds a fact. */
const lines = (container: HTMLElement) =>
  [...container.querySelectorAll("p")].map((line) => line.textContent);

test("the app's own two places are named and explain nothing; the Sorting Box offers to grow", async () => {
  const sorting = await render(<EmptyPlace place={{ kind: "sorting" }} />);
  await expect.element(sorting.getByText("Nothing to Sort")).toBeVisible();
  expect(lines(sorting.container)).toEqual(["Nothing to Sort"]);
  const add = sorting.getByRole("button", { name: "Add Sorting Source…" });
  expect(await kindsAdded(() => add.click())).toEqual(["sorting"]);

  const trash = await render(<EmptyPlace place={{ kind: "trash" }} />);
  await expect.element(trash.getByText("Trash Is Empty")).toBeVisible();
  expect(lines(trash.container)).toEqual(["Trash Is Empty"]);
});

test("a folder of folders lists them, and choosing one goes there", async () => {
  const screen = await render(<EmptyPlace place={PICTURES} />);
  await expect.element(screen.getByText("No Pictures Here")).toBeVisible();
  await expect.element(screen.getByText("Pictures holds 2 folders.")).toBeVisible();
  // An empty folder says so in both figures, exactly as its row in the tree does.
  await expect.element(screen.getByRole("button", { name: "People 0/0" })).toBeVisible();

  // Trips holds two files and Cairo, with three more: its own, then all of it.
  await screen.getByRole("button", { name: "Trips 2/5" }).click();
  const place = getPlace();
  expect(place?.kind === "folder" && place.path.map((crumb) => crumb.title)).toEqual([
    "Pictures",
    "Trips",
  ]);
});

test("a folder holding nothing at all says so, and nothing more", async () => {
  const screen = await render(
    <EmptyPlace
      place={{ kind: "folder", sourceId: 1, path: [...PICTURES.path, { id: 5, title: "People" }] }}
    />,
  );
  await expect.element(screen.getByText("This Folder Is Empty")).toBeVisible();
  // The header already names the folder, and an empty one has no count to give.
  expect(lines(screen.container)).toEqual(["This Folder Is Empty"]);
});

test("a source that cannot be reached says so, not that it is empty", async () => {
  const screen = await render(
    <EmptyPlace place={{ kind: "folder", sourceId: 3, path: [{ id: 3, title: "Archive" }] }} />,
  );
  await expect.element(screen.getByText("Archive is offline", { exact: true })).toBeVisible();
  expect(lines(screen.container)).toEqual([
    "Archive is offline",
    expect.stringMatching(/^[\d,]+ files when last indexed\.$/),
  ]);
});

test("an offline place counts its files, one of them singular", async () => {
  const source = { id: 3, title: "Archive" } as SourceSummary;
  const one = await render(<OfflinePlace source={source} held={{ count: 1 }} />);
  expect(lines(one.container)).toEqual(["Archive is offline", "1 file when last indexed."]);
  await one.unmount();

  const many = await render(<OfflinePlace source={source} held={{ count: 1204, in: "Trips" }} />);
  expect(lines(many.container)).toEqual([
    "Archive is offline",
    `${(1204).toLocaleString()} files in Trips when last indexed.`,
  ]);
});

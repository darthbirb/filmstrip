import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { resetBin } from "../../dev/mock";
import {
  createFolder,
  folderItems,
  indexProgress,
  sortingItems,
  trashItems,
  undoLast,
} from "../../ipc/commands";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { type Place, setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { showReport } from "../undo/report-store";
import { forgetActFocus } from "./act-focus";
import { MovePickerHost, moveFiles, openMovePicker } from "./move-picker";
import { Pane } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { getPaneItem, showInPane } from "./pane-store";

// Against the dev mock: Pictures (1) holds cover.jpg, People (5, empty) and Trips (4) › Cairo (6),
// whose files are felucca.mp4, pyramid.jpg and sphinx.jpg, in that order; Incoming (2) is the one
// sorting source.

const PICTURES: Place = { kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] };
const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};
const TRASH: Place = { kind: "trash" };
const SORTING: Place = { kind: "sorting" };
const JPGS: Place = { kind: "search", query: "jpg", back: null };
const IN_CAIRO: Place = { kind: "search", query: "path:Pictures/Trips/Cairo", back: null };

const address = location.href;

beforeEach(async () => {
  resetBin();
  while (await undoLast()) {}
  openMovePicker(null);
  setNews(null);
  showReport(null);
  updatePreferences({ recent: [] });
  showInPane(null);
  resetIndex();
  await loadIndex();
});

afterEach(async () => {
  history.replaceState(null, "", address);
  forgetActFocus();
  openMovePicker(null);
  showInPane(null);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await expect.poll(async () => (await indexProgress()).moves, { timeout: 5000 }).toEqual([]);
});

async function id(folderId: number, name: string) {
  const row = (await folderItems(folderId)).find((item) => item.diskName === name);
  if (!row) throw new Error(`the mock has no ${name} in folder ${folderId}`);
  return row.id;
}

function Harness() {
  return (
    <PaneDetailProvider>
      <aside
        aria-label="Pane"
        style={{ display: "flex", flexDirection: "column", width: 400, height: 700 }}
      >
        <Pane />
      </aside>
      <MovePickerHost />
    </PaneDetailProvider>
  );
}

const shown = () => document.querySelector("aside h2")?.textContent ?? null;

async function showing(file: number, place: Place) {
  setPlace(place);
  showInPane(file, place);
  const screen = await render(<Harness />);
  const bar = screen.getByRole("toolbar", { name: "Actions" });
  await expect.element(bar).toBeVisible();
  return { screen, bar };
}

async function moveTo(
  screen: Awaited<ReturnType<typeof showing>>["screen"],
  button: string,
  folder: RegExp,
) {
  await screen
    .getByRole("toolbar", { name: "Actions" })
    .getByRole("button", { name: button })
    .click();
  const picker = screen.getByRole("dialog", { name: button.replace("…", "") });
  await picker.getByRole("option", { name: folder }).click();
}

test("Move to… from the pane moves it on to the next file, the focus on Move to… again", async () => {
  const pyramid = await id(6, "pyramid.jpg");
  const sphinx = await id(6, "sphinx.jpg");
  const { screen, bar } = await showing(pyramid, CAIRO);
  await moveTo(screen, "Move to…", /People/);

  await expect.poll(getPaneItem).toBe(sphinx);
  await expect.poll(shown).toBe("sphinx.jpg");
  expect((await folderItems(5)).map((row) => row.id)).toEqual([pyramid]);
  await expect.element(bar.getByRole("button", { name: "Move to…" })).toHaveFocus();
});

test("Move to… on the last file of a place gives the pane the one before it", async () => {
  const pyramid = await id(6, "pyramid.jpg");
  const { screen } = await showing(await id(6, "sphinx.jpg"), CAIRO);
  await moveTo(screen, "Move to…", /People/);

  await expect.poll(getPaneItem).toBe(pyramid);
  await expect.poll(shown).toBe("pyramid.jpg");
});

test("Move to… on a place's only file leaves the pane empty", async () => {
  const cover = await id(1, "cover.jpg");
  const { screen } = await showing(cover, PICTURES);
  await moveTo(screen, "Move to…", /People/);

  await expect.poll(async () => (await folderItems(5)).map((row) => row.id)).toEqual([cover]);
  await expect.poll(getPaneItem).toBeNull();
  await expect.element(screen.getByRole("toolbar", { name: "Actions" })).not.toBeInTheDocument();
});

test("a move between drives moves the pane on as it starts, not when it ends", async () => {
  const pyramid = await id(6, "pyramid.jpg");
  const sphinx = await id(6, "sphinx.jpg");
  const { screen } = await showing(pyramid, CAIRO);
  history.replaceState(null, "", "?across");
  await moveTo(screen, "Move to…", /People/);

  await expect.poll(getPaneItem).toBe(sphinx);
  expect((await indexProgress()).moves).toHaveLength(1);
  await expect.poll(async () => (await indexProgress()).moves, { timeout: 5000 }).toEqual([]);
  expect((await folderItems(5)).map((row) => row.id)).toEqual([pyramid]);
  expect(getPaneItem()).toBe(sphinx);
});

test("a file moved inside the Sorting Box stays in its place, so the pane stays on it", async () => {
  const made = await createFolder(2, "Kept");
  await loadIndex();
  const [first] = await sortingItems();
  if (!first) throw new Error("the mock's Sorting Box is empty");
  const { screen } = await showing(first.id, SORTING);
  await moveTo(screen, "Move to…", /Kept/);

  await expect.poll(async () => (await folderItems(made.folderId)).length).toBe(1);
  expect(getPaneItem()).toBe(first.id);
});

test("a search that still finds the moved file keeps the pane on it", async () => {
  const pyramid = await id(6, "pyramid.jpg");
  const { screen } = await showing(pyramid, JPGS);
  await moveTo(screen, "Move to…", /People/);

  await expect.poll(async () => (await folderItems(5)).map((row) => row.id)).toEqual([pyramid]);
  expect(getPaneItem()).toBe(pyramid);
});

test("a search the moved file no longer matches moves the pane on", async () => {
  const [felucca, pyramid, sphinx] = [
    await id(6, "felucca.mp4"),
    await id(6, "pyramid.jpg"),
    await id(6, "sphinx.jpg"),
  ];
  const { screen } = await showing(pyramid, IN_CAIRO);
  await moveTo(screen, "Move to…", /People/);

  await expect.poll(getPaneItem).not.toBe(pyramid);
  expect([felucca, sphinx]).toContain(getPaneItem());
});

test("a move between drives out of a search keeps the pane, as the search will still find it", async () => {
  const pyramid = await id(6, "pyramid.jpg");
  const { screen } = await showing(pyramid, JPGS);
  history.replaceState(null, "", "?across");
  await moveTo(screen, "Move to…", /People/);

  await expect.poll(async () => (await indexProgress()).moves, { timeout: 5000 }).toEqual([]);
  expect((await folderItems(5)).map((row) => row.id)).toEqual([pyramid]);
  expect(getPaneItem()).toBe(pyramid);
});

test("a file already in the folder the rest are sent to keeps the pane on it", async () => {
  const pyramid = await id(6, "pyramid.jpg");
  const hotel = await id(4, "hotel.jpg");
  await showing(pyramid, IN_CAIRO);
  await moveFiles([pyramid, hotel], { id: 6, title: "Cairo" });

  expect((await folderItems(6)).map((row) => row.id)).toContain(hotel);
  expect(getPaneItem()).toBe(pyramid);
});

test("Restore to… in the Trash moves the pane on, the focus on Restore to… again", async () => {
  const pyramid = await id(6, "pyramid.jpg");
  const sphinx = await id(6, "sphinx.jpg");
  await trashItems([pyramid, sphinx]);
  const { screen, bar } = await showing(pyramid, TRASH);
  await moveTo(screen, "Restore to…", /People/);

  await expect.poll(getPaneItem).toBe(sphinx);
  await expect.poll(shown).toBe("sphinx.jpg");
  await expect.element(bar.getByRole("button", { name: "Restore to…" })).toHaveFocus();
});

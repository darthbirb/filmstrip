import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { resetBin } from "../../dev/mock";
import { recording, theMock } from "../../dev/recording";
import { folderItems, trashItems, undoLast } from "../../ipc/commands";
import { Grid } from "../grid/Grid";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { type Place, setPlace } from "../place";
import { resetSearches } from "../search/results";
import { showReport } from "../undo/report-store";
import {
  answerOnBar,
  answerOnEmpty,
  answerOnGrid,
  answerOnStrip,
  forgetActFocus,
  keepFocusThrough,
} from "./act-focus";
import { MovePickerHost, openMovePicker } from "./move-picker";
import { Pane } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { getPaneItem, showInPane } from "./pane-store";

// Against the dev mock: Pictures (1) holds cover.jpg alone, and Cairo (6) holds felucca.mp4,
// pyramid.jpg and sphinx.jpg, in that order.

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
const TRASHED: Place = { kind: "search", query: "is:trashed", back: null };

beforeEach(async () => {
  resetBin();
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  openMovePicker(null);
  resetSearches();
  showInPane(null);
  resetIndex();
  await loadIndex();
});

const made: Element[] = [];

/** Elements of the test's own, removed after it. */
function make<K extends keyof HTMLElementTagNameMap>(tag: K) {
  const element = document.createElement(tag);
  made.push(element);
  return element;
}

afterEach(() => {
  forgetActFocus();
  openMovePicker(null);
  showInPane(null);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  for (const element of made.splice(0)) element.remove();
});

async function id(name: string, folderId = 6) {
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
    </PaneDetailProvider>
  );
}

const shown = () => document.querySelector("aside h2")?.textContent ?? null;

/** Whether the pane's picture holds the focus. */
const onPicture = () =>
  document.activeElement?.parentElement?.tagName === "FIGURE" &&
  document.activeElement.closest("aside") !== null;

async function showing(file: number, place: Place) {
  setPlace(place);
  showInPane(file, place);
  const screen = await render(<Harness />);
  const bar = screen.getByRole("toolbar", { name: "Actions" });
  return { screen, bar };
}

function WithGrid() {
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex" }}>
        <section aria-label="Grid" style={{ flex: "none", width: 700, height: 600 }}>
          <Grid mode="uniform" />
        </section>
        <aside
          aria-label="Pane"
          style={{ display: "flex", flexDirection: "column", width: 400, height: 700 }}
        >
          <Pane />
        </aside>
      </div>
      <MovePickerHost />
    </PaneDetailProvider>
  );
}

/** The pane's file, chosen from one place, beside the grid of that place or another. */
async function besideGrid(file: number, from: Place, grid: Place = from) {
  await page.viewport(1200, 800);
  setPlace(grid);
  showInPane(file, from);
  const screen = await render(<WithGrid />);
  const region = screen.getByRole("region", { name: "Grid" });
  const bar = screen.getByRole("toolbar", { name: "Actions" });
  await expect.element(bar).toBeVisible();
  return { screen, region, bar };
}

/** Whether the grid itself, not one of its tiles, holds the focus. */
const onGrid = () => document.activeElement?.matches('section[aria-label="Grid"] > div') ?? false;

async function restoreTo(screen: Awaited<ReturnType<typeof besideGrid>>["screen"]) {
  await screen
    .getByRole("toolbar", { name: "Actions" })
    .getByRole("button", { name: "Restore to…" })
    .click();
  await screen
    .getByRole("dialog", { name: "Restore to" })
    .getByRole("option", { name: /People/ })
    .click();
}

test("Delete pressed with Enter leaves the focus on Delete for the next file", async () => {
  const sphinx = await id("sphinx.jpg");
  const { bar } = await showing(await id("pyramid.jpg"), CAIRO);
  const button = bar.getByRole("button", { name: "Delete" });
  await expect.element(button).toBeVisible();
  (button.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  await expect.poll(getPaneItem).toBe(sphinx);
  await expect.poll(shown).toBe("sphinx.jpg");
  await expect.element(bar.getByRole("button", { name: "Delete" })).toHaveFocus();
});

test("Delete clicked on the last file leaves the focus on Delete for the one before", async () => {
  const pyramid = await id("pyramid.jpg");
  const { bar } = await showing(await id("sphinx.jpg"), CAIRO);
  await bar.getByRole("button", { name: "Delete" }).click();

  await expect.poll(getPaneItem).toBe(pyramid);
  await expect.poll(shown).toBe("pyramid.jpg");
  await expect.element(bar.getByRole("button", { name: "Delete" })).toHaveFocus();
});

test("Restore pressed with Enter in the Trash leaves the focus on Restore for the next file", async () => {
  const pyramid = await id("pyramid.jpg");
  const sphinx = await id("sphinx.jpg");
  await trashItems([pyramid, sphinx]);
  const { bar } = await showing(pyramid, TRASH);
  const button = bar.getByRole("button", { name: "Restore", exact: true });
  await expect.element(button).toBeVisible();
  (button.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  await expect.poll(getPaneItem).toBe(sphinx);
  await expect.poll(shown).toBe("sphinx.jpg");
  await expect.element(bar.getByRole("button", { name: "Restore", exact: true })).toHaveFocus();
});

test("restored inside a search, the file's bar has no Restore, so its picture takes the focus", async () => {
  const pyramid = await id("pyramid.jpg");
  await trashItems([pyramid, await id("sphinx.jpg"), await id("felucca.mp4")]);
  const { screen, bar } = await showing(pyramid, TRASHED);
  const button = bar.getByRole("button", { name: "Restore", exact: true });
  await expect.element(button).toBeVisible();
  await expect.element(screen.getByRole("listbox", { name: "Filmstrip" })).toBeVisible();
  await button.click();

  await expect.element(bar.getByRole("button", { name: "Move to…" })).toBeVisible();
  expect(getPaneItem()).toBe(pyramid);
  await expect.poll(onPicture).toBe(true);
});

test("restored inside a search whose list comes back after the file's detail, the picture still ends with the focus", async () => {
  const pyramid = await id("pyramid.jpg");
  await trashItems([pyramid, await id("sphinx.jpg"), await id("felucca.mp4")]);
  const { screen, bar } = await showing(pyramid, TRASHED);
  const frame = screen
    .getByRole("listbox", { name: "Filmstrip" })
    .getByRole("option", { name: "pyramid.jpg" });
  await expect.element(frame).toBeVisible();

  const real = theMock();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let restoring = false;
  await recording(
    async () => {
      await bar.getByRole("button", { name: "Restore", exact: true }).click();
      // The detail lands first: the library's bar, and the strip still on its old list.
      await expect.element(bar.getByRole("button", { name: "Move to…" })).toBeVisible();
      await expect.element(frame).toHaveFocus();
      release();
      await expect.element(frame).not.toBeInTheDocument();
      await expect.poll(onPicture).toBe(true);
    },
    (cmd, args) => {
      if (cmd === "restore_items") restoring = true;
      if (!restoring || cmd !== "search") return undefined;
      return held.then(() => real(cmd, args));
    },
  );
});

test("with no such button on the next bar, the strip's shown frame takes the focus once drawn", async () => {
  const bar = make("div");
  const strip = make("div");
  strip.setAttribute("role", "listbox");
  strip.setAttribute("aria-label", "Filmstrip");
  const pane = make("section");
  pane.append(bar, strip);
  document.body.append(pane);

  keepFocusThrough("Restore", Promise.resolve());
  answerOnBar(bar, 1);
  expect(document.activeElement).toBe(document.body);

  const frame = make("button");
  strip.append(frame);
  answerOnStrip(frame, null);
  expect(document.activeElement).toBe(frame);
});

test("a focus that moves on its own drops the request, so a later bar takes nothing", async () => {
  const elsewhere = make("button");
  const bar = make("div");
  const again = make("button");
  again.setAttribute("aria-label", "Delete");
  bar.append(again);
  document.body.append(elsewhere, bar);

  let finish = () => {};
  keepFocusThrough("Delete", new Promise<void>((resolve) => (finish = resolve)));
  elsewhere.focus();
  elsewhere.blur();
  answerOnBar(bar, 1);
  expect(document.activeElement).toBe(document.body);
  finish();
});

test("Delete pressed with Enter on a place's only file gives the focus to the grid it emptied", async () => {
  const cover = await id("cover.jpg", 1);
  const { region, bar } = await besideGrid(cover, PICTURES);
  await expect.element(region.getByRole("button", { name: "cover.jpg" })).toBeVisible();
  (bar.getByRole("button", { name: "Delete" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  await expect.poll(getPaneItem).toBeNull();
  await expect.element(region.getByRole("button", { name: "cover.jpg" })).not.toBeInTheDocument();
  await expect.poll(onGrid).toBe(true);
});

test("Restore on the Trash's last file gives the focus to the Trash's grid", async () => {
  const pyramid = await id("pyramid.jpg");
  await trashItems([pyramid]);
  const { region, bar } = await besideGrid(pyramid, TRASH);
  await expect.element(region.getByRole("button", { name: "pyramid.jpg" })).toBeVisible();
  await bar.getByRole("button", { name: "Restore", exact: true }).click();

  await expect.poll(getPaneItem).toBeNull();
  await expect.element(region.getByRole("button", { name: "pyramid.jpg" })).not.toBeInTheDocument();
  await expect.poll(onGrid).toBe(true);
});

test("a pane emptied beside the grid of another place gives the focus to that grid's tab stop", async () => {
  const cover = await id("cover.jpg", 1);
  const { region, bar } = await besideGrid(cover, PICTURES, CAIRO);
  const felucca = region.getByRole("button", { name: "felucca.mp4" });
  await expect.element(felucca).toBeVisible();
  await bar.getByRole("button", { name: "Delete" }).click();

  await expect.poll(getPaneItem).toBeNull();
  await expect.element(felucca).toHaveFocus();
});

test("Restore to… on the Trash's last file gives the focus to the grid, as Restore does", async () => {
  const pyramid = await id("pyramid.jpg");
  await trashItems([pyramid]);
  const { screen, region } = await besideGrid(pyramid, TRASH);
  await expect.element(region.getByRole("button", { name: "pyramid.jpg" })).toBeVisible();
  await restoreTo(screen);

  await expect.poll(getPaneItem).toBeNull();
  await expect.element(region.getByRole("button", { name: "pyramid.jpg" })).not.toBeInTheDocument();
  await expect.poll(onGrid).toBe(true);
});

test("restored to a folder inside a search, the file's bar has no Restore to…, so its picture takes the focus", async () => {
  const pyramid = await id("pyramid.jpg");
  await trashItems([pyramid, await id("sphinx.jpg"), await id("felucca.mp4")]);
  const { screen, bar } = await besideGrid(pyramid, TRASHED);
  await expect.element(screen.getByRole("listbox", { name: "Filmstrip" })).toBeVisible();
  await restoreTo(screen);

  await expect.element(bar.getByRole("button", { name: "Move to…" })).toBeVisible();
  expect(getPaneItem()).toBe(pyramid);
  await expect.poll(onPicture).toBe(true);
});

test("a tile that took the focus and then left with its file hands it to the grid", async () => {
  const grid = make("div");
  grid.dataset.drop = "grid";
  grid.tabIndex = -1;
  const tile = make("button");
  tile.dataset.item = "1";
  tile.tabIndex = 0;
  grid.append(tile);
  document.body.append(grid);

  keepFocusThrough("Delete", Promise.resolve());
  answerOnEmpty();
  expect(document.activeElement).toBe(tile);

  tile.remove();
  answerOnGrid(grid);
  expect(document.activeElement).toBe(grid);
});

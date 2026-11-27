import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { resetBin } from "../../dev/mock";
import { recording, theMock } from "../../dev/recording";
import { folderItems, trashItems, undoLast } from "../../ipc/commands";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { type Place, setPlace } from "../place";
import { resetSearches } from "../search/results";
import { showReport } from "../undo/report-store";
import { answerOnBar, answerOnStrip, forgetActFocus, keepFocusThrough } from "./act-focus";
import { Pane } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { getPaneItem, showInPane } from "./pane-store";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg, in that order.

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
  showInPane(null);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  for (const element of made.splice(0)) element.remove();
});

async function id(name: string) {
  const row = (await folderItems(6)).find((item) => item.diskName === name);
  if (!row) throw new Error(`the mock has no ${name} in Cairo`);
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

import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../dev/recording";
import {
  deleteFolder,
  destinationKeys,
  folderItems,
  removeDestinationKey,
  setDestinationKey,
  undoLast,
} from "../ipc/commands";
import { Grid } from "./grid/Grid";
import { clearChecked, getSelection } from "./grid/selection";
import { useDestinationKeys } from "./keys";
import { Foot } from "./navigation/Foot";
import { getNews, setNews } from "./navigation/foot-slot";
import { loadIndex, refreshIndex, resetIndex } from "./navigation/index-store";
import { getPaneItem, showInPane } from "./pane/pane-store";
import { type Place, setPlace } from "./place";
import { showReport } from "./undo/report-store";

// Against the dev mock: Pictures (1) holds People (5, empty) and Trips (4), and Trips holds Cairo
// (6), whose files are felucca.mp4, pyramid.jpg and sphinx.jpg, in that order.

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
  while (await undoLast()) {}
  for (const one of await destinationKeys()) await removeDestinationKey(one.key);
  await setDestinationKey("1", 5);
  await setDestinationKey("2", 6);
  setNews(null);
  showReport(null);
  resetIndex();
  await loadIndex();
  setPlace(CAIRO);
  clearChecked();
  showInPane(null);
});

function Keys() {
  useDestinationKeys();
  return null;
}

async function renderIt() {
  await page.viewport(1200, 800);
  await render(
    <>
      <Keys />
      <div style={{ width: 900, height: 500 }}>
        <Grid mode="uniform" />
      </div>
      <div style={{ width: 280 }}>
        <Foot />
      </div>
    </>,
  );
  await expect.element(page.getByRole("button", { name: "sphinx.jpg" })).toBeVisible();
}

const idOf = async (name: string) =>
  (await folderItems(6)).find((row) => row.diskName === name)?.id ?? -1;
const moved = (calls: [string, unknown][]) => calls.find(([cmd]) => cmd === "move_items")?.[1];

test("a key moves what is checked to its folder, and says so as Move to… would", async () => {
  await renderIt();
  const ids = [await idOf("felucca.mp4"), await idOf("sphinx.jpg")];
  await userEvent.click(page.getByRole("checkbox", { name: "Check felucca.mp4" }));
  await userEvent.click(page.getByRole("checkbox", { name: "Check sphinx.jpg" }));
  await recording(async (calls) => {
    await userEvent.keyboard("1");
    await expect.poll(() => moved(calls)).toEqual({ itemIds: ids, folderId: 5 });
  });
  await expect.element(page.getByText("Moved 2 files to People.")).toBeVisible();
  await expect.poll(() => getSelection().ids).toEqual([]);
});

test("with nothing checked it moves the pane's file, and the pane moves on to the next", async () => {
  await renderIt();
  const [pyramid, sphinx] = [await idOf("pyramid.jpg"), await idOf("sphinx.jpg")];
  showInPane(pyramid, CAIRO);
  await recording(async (calls) => {
    await userEvent.keyboard("1");
    await expect.poll(() => moved(calls)).toEqual({ itemIds: [pyramid], folderId: 5 });
  });
  await expect.poll(getPaneItem).toBe(sphinx);
  await expect.element(page.getByText("Moved pyramid.jpg to People.")).toBeVisible();
});

test("the number pad's digits are the same keys", async () => {
  await renderIt();
  showInPane(await idOf("sphinx.jpg"), CAIRO);
  await recording(async (calls) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", code: "Numpad1", bubbles: true }),
    );
    await expect.poll(() => moved(calls)).toBeDefined();
  });
});

test("a key for the folder the files are in moves nothing and says so", async () => {
  await renderIt();
  showInPane(await idOf("sphinx.jpg"), CAIRO);
  await recording(async (calls) => {
    await userEvent.keyboard("2");
    await expect.element(page.getByText("Already in Cairo.")).toBeVisible();
    expect(moved(calls)).toBeUndefined();
  });
});

test("a free key does nothing and says nothing", async () => {
  await renderIt();
  showInPane(await idOf("sphinx.jpg"), CAIRO);
  await recording(async (calls) => {
    await userEvent.keyboard("7");
    expect(moved(calls)).toBeUndefined();
  });
  expect(getNews()).toBeNull();
});

test("a key whose folder has gone moves nothing, and says which key and where it was", async () => {
  await setDestinationKey("4", 5);
  await deleteFolder(5, null);
  await refreshIndex();
  await renderIt();
  showInPane(await idOf("sphinx.jpg"), CAIRO);
  await userEvent.keyboard("4");
  await expect.element(page.getByText("Key 4 has no folder.")).toBeVisible();
  await expect.element(page.getByText("People has gone from Pictures.")).toBeVisible();
});

test("a key does nothing in a field, or in the Trash", async () => {
  await renderIt();
  showInPane(await idOf("sphinx.jpg"), CAIRO);
  await recording(async (calls) => {
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    await userEvent.keyboard("1");
    field.remove();
    setPlace({ kind: "trash" });
    await userEvent.keyboard("1");
    expect(moved(calls)).toBeUndefined();
  });
});

import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { refuseRecycling, resetBin } from "../../dev/mock";
import { folderItems, undoLast } from "../../ipc/commands";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { type Place, setPlace } from "../place";
import { getReport, showReport } from "../undo/report-store";
import { deleteFiles } from "./delete";
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

beforeEach(async () => {
  resetBin();
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  setPlace(CAIRO);
  resetIndex();
  await loadIndex();
});

async function id(name: string) {
  const row = (await folderItems(6)).find((item) => item.diskName === name);
  if (!row) throw new Error(`the mock has no ${name} in Cairo`);
  return row.id;
}

function Harness() {
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex", flexDirection: "column", width: 400, height: 700 }}>
        <Pane />
      </div>
      <Foot />
    </PaneDetailProvider>
  );
}

test("Delete sends the file to the trash, says so, and the pane moves on to the next file", async () => {
  showInPane(await id("pyramid.jpg"), CAIRO);
  const sphinx = await id("sphinx.jpg");
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Delete" }).click();

  await expect.element(screen.getByText("Deleted pyramid.jpg.")).toBeVisible();
  expect((await folderItems(6)).map((row) => row.diskName)).toEqual(["felucca.mp4", "sphinx.jpg"]);
  await expect.poll(getPaneItem).toBe(sphinx);
});

test("the last file deleted gives the pane the one before it, and Undo brings it back", async () => {
  const sphinx = await id("sphinx.jpg");
  const pyramid = await id("pyramid.jpg");
  showInPane(sphinx, CAIRO);
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Delete" }).click();
  await expect.poll(getPaneItem).toBe(pyramid);

  await screen.getByRole("button", { name: "Undo" }).click();
  await expect.element(screen.getByText("sphinx.jpg is back in Cairo.")).toBeVisible();
  expect((await folderItems(6)).map((row) => row.id)).toContain(sphinx);
});

test("a file the Recycle Bin would not take stays where it was, and the foot says why", async () => {
  const pyramid = await id("pyramid.jpg");
  refuseRecycling([pyramid]);
  showInPane(pyramid, CAIRO);
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Delete" }).click();

  await expect
    .element(screen.getByText("The Recycle Bin would not take pyramid.jpg, so it stays in Cairo."))
    .toBeVisible();
  await expect
    .element(
      screen.getByText(
        "It may be too large for the Recycle Bin, or the Recycle Bin is turned off. Nothing was deleted.",
      ),
    )
    .toBeVisible();
  expect(screen.getByRole("button", { name: "Undo" }).query()).toBeNull();
  expect(getReport()).toBeNull();
  expect(await folderItems(6)).toContainEqual(expect.objectContaining({ id: pyramid }));
  expect(getPaneItem()).toBe(pyramid);
});

test("in a set, the rest are one batch with Undo and the one refused is named", async () => {
  const ids = (await folderItems(6)).map((row) => row.id);
  const pyramid = await id("pyramid.jpg");
  refuseRecycling([pyramid]);
  const screen = await render(<Harness />);
  await deleteFiles(ids);

  await expect
    .element(
      screen.getByText(
        "Deleted 2 of 3 files. The Recycle Bin would not take pyramid.jpg, so it stays in Cairo.",
      ),
    )
    .toBeVisible();
  expect(getReport()).toBeNull();
  expect((await folderItems(6)).map((row) => row.diskName)).toEqual(["pyramid.jpg"]);

  await screen.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await folderItems(6)).length).toBe(3);
});

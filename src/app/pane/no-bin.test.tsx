import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { onDriveWithoutBin, refuseDeleting, resetBin } from "../../dev/mock";
import { folderItems, undoLast } from "../../ipc/commands";
import { formatBytes } from "../../lib/format";
import { checkAll, clearChecked, getSelection, useSelectionKeys } from "../grid/selection";
import {
  DeleteQuestion,
  deleteFolderAsking,
  resetDeleteQuestion,
} from "../navigation/delete-folder";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { getIndex, loadIndex, resetIndex } from "../navigation/index-store";
import { type Place, setPlace } from "../place";
import { getReport, showReport } from "../undo/report-store";
import { deleteFiles } from "./delete";
import { NoBinQuestion, resetNoBinQuestion } from "./no-bin";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg, 2.4 MB each.

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
  resetNoBinQuestion();
  resetDeleteQuestion();
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

const names = async () => (await folderItems(6)).map((row) => row.diskName).sort();

function Harness() {
  useSelectionKeys([]);
  return (
    <div style={{ width: 640 }}>
      <DeleteQuestion />
      <NoBinQuestion />
      <Foot />
    </div>
  );
}

test("a file on a drive with no Recycle Bin is asked about, and Cancel, with the focus, keeps it", async () => {
  const pyramid = await id("pyramid.jpg");
  onDriveWithoutBin([pyramid], "USB Drive (E:)");
  const screen = await render(<Harness />);
  await deleteFiles([pyramid]);

  await expect.element(screen.getByText("USB Drive (E:) has no Recycle Bin")).toBeVisible();
  const size = formatBytes(
    (await folderItems(6)).find((row) => row.id === pyramid)?.sizeBytes ?? 0,
  );
  await expect
    .element(screen.getByText(`Delete pyramid.jpg, ${size}, for good? Undo cannot bring it back.`))
    .toBeVisible();
  const cancel = screen.getByRole("button", { name: "Cancel" });
  await expect.element(cancel).toHaveFocus();
  expect(screen.getByRole("button", { name: "Show Files" }).query()).toBeNull();
  expect(await names()).toContain("pyramid.jpg");

  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByText("USB Drive (E:) has no Recycle Bin"))
    .not.toBeInTheDocument();
  expect(await names()).toEqual(["felucca.mp4", "pyramid.jpg", "sphinx.jpg"]);

  await deleteFiles([pyramid]);
  await userEvent.keyboard("{Escape}");
  await expect
    .element(screen.getByText("USB Drive (E:) has no Recycle Bin"))
    .not.toBeInTheDocument();
  expect(await names()).toContain("pyramid.jpg");
});

test("Delete Permanently deletes it outright, and the foot says so with no Undo", async () => {
  const pyramid = await id("pyramid.jpg");
  onDriveWithoutBin([pyramid], "USB Drive (E:)");
  const screen = await render(<Harness />);
  await deleteFiles([pyramid]);
  await screen.getByRole("button", { name: "Delete Permanently" }).click();

  await expect
    .element(screen.getByText("Deleted pyramid.jpg from USB Drive (E:) for good."))
    .toBeVisible();
  expect(screen.getByRole("button", { name: "Undo" }).query()).toBeNull();
  expect(await names()).toEqual(["felucca.mp4", "sphinx.jpg"]);
  expect(await undoLast()).toBeNull();
});

test("in a mixed set the rest go to the Recycle Bin with Undo, and only the others are asked about", async () => {
  const [felucca, pyramid, sphinx] = await Promise.all(
    ["felucca.mp4", "pyramid.jpg", "sphinx.jpg"].map(id),
  );
  onDriveWithoutBin([pyramid as number, sphinx as number], "USB Drive (E:)");
  const screen = await render(<Harness />);
  await deleteFiles([felucca as number, pyramid as number, sphinx as number]);

  await expect
    .element(screen.getByText("2 of 3 files are on a drive with no Recycle Bin"))
    .toBeVisible();
  await expect
    .element(
      screen.getByText(
        /^Delete them, .+, for good\? Undo cannot bring them back\. The other 1 went to the Recycle Bin\.$/,
      ),
    )
    .toBeVisible();
  await expect
    .element(screen.getByText("Deleted 1 of 3 files. The other 2 are in the banner."))
    .toBeVisible();
  await expect.element(screen.getByText("On USB Drive (E:)")).toBeVisible();
  await expect.element(screen.getByText("pyramid.jpg", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("sphinx.jpg", { exact: true })).toBeVisible();
  expect(await names()).toEqual(["pyramid.jpg", "sphinx.jpg"]);

  await screen.getByRole("button", { name: "Hide Files" }).click();
  await expect.element(screen.getByText("On USB Drive (E:)")).not.toBeInTheDocument();
});

test("a selection wholly on two such drives names both, and one that would not go stays", async () => {
  const [pyramid, sphinx] = await Promise.all(["pyramid.jpg", "sphinx.jpg"].map(id));
  onDriveWithoutBin([pyramid as number], "USB Drive (E:)");
  onDriveWithoutBin([sphinx as number], "SD Card (F:)");
  refuseDeleting([sphinx as number]);
  const screen = await render(<Harness />);
  await deleteFiles([pyramid as number, sphinx as number]);

  await expect
    .element(screen.getByText("USB Drive (E:) and SD Card (F:) have no Recycle Bin"))
    .toBeVisible();
  await expect.element(screen.getByText("On SD Card (F:)")).toBeVisible();
  await screen.getByRole("button", { name: "Delete Permanently" }).click();

  await expect
    .element(
      screen.getByText(
        "Deleted 1 of 2 files for good. sphinx.jpg could not be deleted and stays in Cairo.",
      ),
    )
    .toBeVisible();
  expect(getReport()).toBeNull();
  expect(await names()).toEqual(["felucca.mp4", "sphinx.jpg"]);
});

test("a folder on such a drive says it once: its files go permanently, and × has the focus", async () => {
  onDriveWithoutBin(
    (await folderItems(6)).map((row) => row.id),
    "USB Drive (E:)",
  );
  const screen = await render(<Harness />);
  await deleteFolderAsking({ id: 6, name: "Cairo" }, getIndex().sources ?? []);

  await expect.element(screen.getByText("Cairo holds 3 files")).toBeVisible();
  await expect
    .element(
      screen.getByText(
        /^USB Drive \(E:\) has no Recycle Bin\. Deleted, its files go for good, .+, and Undo cannot bring them back\.$/,
      ),
    )
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await expect
    .element(screen.getByRole("button", { name: "Delete Files Permanently" }))
    .toBeVisible();
  expect(screen.getByRole("button", { name: "Delete Files Too" }).query()).toBeNull();

  await screen.getByRole("button", { name: "Delete Files Permanently" }).click();
  await expect.element(screen.getByText("Deleted Cairo and its 3 files for good.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Undo" }).query()).toBeNull();
});

test("Escape puts the question away and the files stay selected as they were", async () => {
  const pyramid = await id("pyramid.jpg");
  onDriveWithoutBin([pyramid], "USB Drive (E:)");
  clearChecked();
  checkAll([pyramid]);
  const screen = await render(<Harness />);
  await deleteFiles([pyramid]);
  await expect.element(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

  await userEvent.keyboard("{Escape}");

  await expect
    .element(screen.getByText("USB Drive (E:) has no Recycle Bin"))
    .not.toBeInTheDocument();
  expect(getSelection().ids).toEqual([pyramid]);
  clearChecked();
});

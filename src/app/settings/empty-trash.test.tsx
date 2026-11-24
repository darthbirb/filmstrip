import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { emptyOutside, refuseDeleting, resetBin } from "../../dev/mock";
import {
  deleteFolder,
  emptyTrash,
  folderItems,
  renameItem,
  restoreItems,
  trashItems,
  trashListing,
  trashToEmpty,
  undoLast,
} from "../../ipc/commands";
import { formatBytes } from "../../lib/format";
import { Foot } from "../navigation/Foot";
import { getNews, setNews } from "../navigation/foot-slot";
import { loadIndex, refreshIndex, resetIndex } from "../navigation/index-store";
import { ReportBanner } from "../undo/ReportBanner";
import { getReport, showReport } from "../undo/report-store";
import { Settings } from "./Settings";
import { getEmptying } from "./settings-store";

// Against the dev mock, whose files are each 2,400,000 bytes; Cairo (6) holds a few. Artboards ›
// The Trash in the Recycle Bin.

beforeEach(async () => {
  await page.viewport(1280, 820);
  resetBin();
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  resetIndex();
  await loadIndex();
});

const opened = () => render(<Settings open onClose={() => undefined} section="trash" />);

async function cairo(count: number) {
  return (await folderItems(6)).map((row) => row.id).slice(0, count);
}

async function trashed(ids: number[]) {
  await trashItems(ids);
  await refreshIndex();
}

const emptied = () => expect.poll(() => getEmptying(), { timeout: 5000 }).toBeNull();

test("Empty Trash… is absent with nothing in the Trash, and there in danger once it holds files", async () => {
  const screen = await opened();
  await expect.element(screen.getByText("Nothing in it")).toBeVisible();
  expect(screen.getByRole("button", { name: "Empty Trash…" }).query()).toBeNull();
  await expect
    .element(
      screen.getByText(
        "On a drive with no Recycle Bin, such as a USB stick or a network share, Delete asks first, and deletes for good.",
      ),
    )
    .toBeVisible();

  await trashed(await cairo(2));
  await expect.element(screen.getByRole("button", { name: "Empty Trash…" })).toBeVisible();
});

test("its question counts the files and their space, keeps the rest of the bin, and Cancel has the focus", async () => {
  await trashed(await cairo(2));
  const screen = await opened();
  await screen.getByRole("button", { name: "Empty Trash…" }).click();

  await expect
    .element(
      screen.getByText(
        `Delete the 2 files the library sent to the Recycle Bin, ${formatBytes(4_800_000)}, for good? Only these go; the rest of the Recycle Bin is left as it is. Undo cannot bring them back.`,
      ),
    )
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await expect
    .element(screen.getByRole("button", { name: "Empty Trash", exact: true }))
    .toBeVisible();

  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Cancel" }).query()).toBeNull();
  await expect.element(screen.getByRole("button", { name: "Empty Trash…" })).toHaveFocus();
  expect(await trashListing()).toHaveLength(2);
});

test("emptying counts as it goes, the foot says it is done, and Ctrl+Z passes over what went", async () => {
  const [renamed, ...gone] = await cairo(3);
  if (renamed === undefined) throw new Error("Cairo holds files");
  await renameItem(renamed, "renamed.jpg");
  await trashed(gone);
  const screen = await render(
    <>
      <Settings open onClose={() => undefined} section="trash" />
      <Foot />
    </>,
  );
  await screen.getByRole("button", { name: "Empty Trash…" }).click();
  await screen.getByRole("button", { name: "Empty Trash", exact: true }).click();

  await expect.element(screen.getByText("Emptying · 0 of 2 files")).toBeVisible();
  expect(screen.getByRole("button", { name: "Empty Trash…" }).query()).toBeNull();
  await emptied();

  expect(getNews()).toEqual({
    kind: "said",
    line: `Emptied the Trash: 2 files, ${formatBytes(4_800_000)}, deleted for good.`,
  });
  await expect.element(screen.getByText("Nothing in it")).toBeVisible();
  expect(await trashListing()).toHaveLength(0);
  const back = await undoLast();
  expect(back?.batch.act).toMatchObject({ kind: "renameFile", to: "renamed.jpg" });
  expect(await undoLast()).toBeNull();
});

test("files skipped are counted in a band, with Show in Trash for the one that stays", async () => {
  const ids = await cairo(3);
  await trashed(ids);
  const [outside, kept] = ids;
  if (outside === undefined || kept === undefined) throw new Error("Cairo holds files");
  emptyOutside([outside]);
  refuseDeleting([kept]);
  const screen = await render(
    <>
      <Settings open onClose={() => undefined} section="trash" />
      <Foot />
    </>,
  );
  await screen.getByRole("button", { name: "Empty Trash…" }).click();
  await screen.getByRole("button", { name: "Empty Trash", exact: true }).click();
  await emptied();

  const line =
    "Emptied 1 of 3 files for good. 1 was no longer in the Recycle Bin, and 1 would not go and stays in the Trash.";
  expect(getNews()).toEqual({ kind: "skipped", line, first: kept });
  await expect.element(screen.getByText(line)).toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Show in Trash" })).toBeInTheDocument();
  expect((await trashListing()).map((one) => one.id)).toEqual([kept]);

  const report = getReport();
  expect(report?.sentence).toBe("1 of 3 files was deleted for good");
  expect(report?.rows.map((row) => [row.id, row.at.kind, row.reason.kind])).toEqual([
    [kept, "trash", "inUse"],
  ]);
});

test("the files that stayed are listed in the banner, each with why and Show in Trash", async () => {
  const ids = await cairo(2);
  await trashed(ids);
  refuseDeleting(ids);
  const [first] = await trashListing();
  if (!first) throw new Error("the Trash holds files");
  const screen = await render(
    <>
      <ReportBanner />
      <Settings open onClose={() => undefined} section="trash" />
    </>,
  );
  await screen.getByRole("button", { name: "Empty Trash…" }).click();
  await screen.getByRole("button", { name: "Empty Trash", exact: true }).click();
  await emptied();

  await expect
    .element(screen.getByText("The 2 files could not be deleted for good"))
    .toBeInTheDocument();
  await expect.element(screen.getByText("Still in the Trash")).toBeInTheDocument();
  expect(screen.getByText("Open in another app").elements()).toHaveLength(2);
  await expect
    .element(screen.getByRole("button", { name: `Show ${first.diskName} in Trash` }))
    .toBeInTheDocument();
});

test("a file deleted while the question waits is not counted, and stays", async () => {
  const [first, later] = await cairo(2);
  if (first === undefined || later === undefined) throw new Error("Cairo holds files");
  await trashed([first]);
  const screen = await opened();
  await screen.getByRole("button", { name: "Empty Trash…" }).click();
  await trashed([later]);
  await screen.getByRole("button", { name: "Empty Trash", exact: true }).click();
  await emptied();

  expect((await trashListing()).map((one) => one.id)).toEqual([later]);
});

test("emptying when every file counted has left the Trash leaves the foot as it was", async () => {
  const [one] = await cairo(1);
  if (one === undefined) throw new Error("Cairo holds files");
  await trashed([one]);
  const screen = await opened();
  await screen.getByRole("button", { name: "Empty Trash…" }).click();
  await restoreItems([one], null);
  const before = { kind: "said", line: "Restored 1 file." } as const;
  setNews(before);
  await screen.getByRole("button", { name: "Empty Trash", exact: true }).click();
  await emptied();

  expect(getNews()).toEqual(before);
});

test("a folder deleted with its files leaves Undo once they are emptied", async () => {
  await deleteFolder(6, { kind: "trash" });
  await emptyTrash((await trashToEmpty()).files);

  expect(await undoLast()).toBeNull();
});

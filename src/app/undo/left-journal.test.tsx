import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { emptyOutside, resetBin } from "../../dev/mock";
import { deleteFolder, folderItems, trashItems, trashListing, undoLast } from "../../ipc/commands";
import { watchDeletes } from "../deleted";
import { Foot } from "../navigation/Foot";
import { getNews, setNews } from "../navigation/foot-slot";
import { loadIndex, refreshIndex, resetIndex } from "../navigation/index-store";
import { settleTrash, watchTrashOpening } from "../navigation/look-in-bin";
import { setPlace } from "../place";
import { Settings } from "../settings/Settings";
import { getEmptying } from "../settings/settings-store";
import { afterAct } from "./undo";

// Against the dev mock: Trips (4) holds boarding-pass.png and hotel.jpg, and Cairo (6) a few more.
// DECISIONS.md "Emptying the Trash" and "The Trash is the Recycle Bin".

let stop: () => void = () => undefined;

beforeAll(() => watchDeletes());

beforeEach(async () => {
  await page.viewport(1280, 820);
  resetBin();
  while (await undoLast()) {}
  setNews(null);
  setPlace({ kind: "sorting" });
  resetIndex();
  await loadIndex();
});

afterEach(() => stop());

const undoButton = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole("button", { name: "Undo" });

test("opening the Trash takes Undo off the line of an act whose files were all emptied from the bin", async () => {
  const files = (await folderItems(6)).map((row) => row.id);
  const screen = await render(<Foot />);
  const deleted = await deleteFolder(6, { kind: "trash" });
  if (deleted.kind !== "done" || !deleted.batch) throw new Error("the mock deleted nothing");
  afterAct(deleted.batch);
  const line = `Deleted Cairo and its ${files.length} files.`;
  await expect.element(screen.getByText(line)).toBeVisible();
  await expect.element(undoButton(screen)).toBeVisible();

  emptyOutside(files.slice(0, 1));
  await settleTrash();
  expect(await trashListing()).toHaveLength(files.length - 1);
  await expect.element(undoButton(screen)).toBeVisible();

  stop = watchTrashOpening();
  emptyOutside(files.slice(1));
  setPlace({ kind: "trash" });

  await expect.poll(() => undoButton(screen).elements().length).toBe(0);
  expect(getNews()).toEqual({ kind: "said", line });
  await expect.element(screen.getByText(line)).toBeVisible();
});

test("Empty Trash… leaves no Undo on the foot for an act whose files it found emptied", async () => {
  const files = (await folderItems(4)).map((row) => row.id);
  const trashed = await trashItems(files);
  if (trashed.kind !== "done" || !trashed.batch) throw new Error("the mock deleted nothing");
  emptyOutside(files);
  await refreshIndex();
  const screen = await render(
    <>
      <Settings open onClose={() => undefined} section="trash" />
      <Foot />
    </>,
  );
  afterAct(trashed.batch);
  await expect.element(undoButton(screen)).toBeInTheDocument();

  await screen.getByRole("button", { name: "Empty Trash…" }).click();
  await screen.getByRole("button", { name: "Empty Trash", exact: true }).click();
  await expect.poll(() => getEmptying(), { timeout: 5000 }).toBeNull();

  expect(undoButton(screen).elements()).toHaveLength(0);
  expect(await undoLast()).toBeNull();
});

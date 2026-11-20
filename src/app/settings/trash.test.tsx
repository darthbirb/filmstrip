import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { folderItems, trashItems, undoLast } from "../../ipc/commands";
import { formatBytes } from "../../lib/format";
import { loadIndex, refreshIndex, resetIndex } from "../navigation/index-store";
import { Settings } from "./Settings";

// Against the dev mock, whose files are each 2,400,000 bytes; Cairo (6) holds a few.

beforeEach(async () => {
  await page.viewport(1280, 820);
  while (await undoLast()) {}
  resetIndex();
  await loadIndex();
});

const opened = () => render(<Settings open onClose={() => undefined} section="trash" />);

test("Trash keeps no limits: what the library has in the Recycle Bin, and where a deleted file goes", async () => {
  const screen = await opened();
  await expect.element(screen.getByRole("heading", { name: "Trash" })).toBeVisible();
  await expect.element(screen.getByText("Nothing in it")).toBeVisible();
  await expect
    .element(
      screen.getByText(
        "Deleted files go to the Windows Recycle Bin, on their own drive. Restore brings them back from the Trash.",
      ),
    )
    .toBeVisible();
  expect(
    screen.getByRole("button", { name: /Keep For|Total Size|Size per File/ }).query(),
  ).toBeNull();
});

test("its head counts the files in the Trash and the space they take", async () => {
  const ids = (await folderItems(6)).map((row) => row.id).slice(0, 2);
  await trashItems(ids);
  await refreshIndex();
  const screen = await opened();
  await expect.element(screen.getByText(`2 files · ${formatBytes(4_800_000)}`)).toBeVisible();
});

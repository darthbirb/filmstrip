import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { folderItems, trashItems, undoLast } from "../../ipc/commands";
import { formatBytes } from "../../lib/format";
import { setPlace } from "../place";
import { Breadcrumb } from "./Breadcrumb";
import { loadIndex, refreshIndex, resetIndex } from "./index-store";
import { Navigation } from "./Navigation";
import { Rail } from "./Rail";

// Against the dev mock, whose files are each 2,400,000 bytes.

beforeEach(async () => {
  while (await undoLast()) {}
  setPlace({ kind: "trash" });
  resetIndex();
  await loadIndex();
});

test("an empty Trash carries no count, and one holding files counts them on its row, its square and its header", async () => {
  const screen = await render(
    <div style={{ width: 300 }}>
      <Breadcrumb />
      <Navigation />
      <Rail />
    </div>,
  );
  await expect.element(screen.getByRole("treeitem", { name: "Trash", exact: true })).toBeVisible();
  expect(screen.getByText(/ · /).elements()).toHaveLength(0);

  const ids = (await folderItems(6)).map((row) => row.id);
  await trashItems(ids.slice(0, 2));
  await refreshIndex();
  await expect.element(screen.getByRole("treeitem", { name: "Trash 2" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Trash", exact: true }))
    .toHaveAttribute("title", "Trash · 2");
  await expect.element(screen.getByText(`2 · ${formatBytes(4_800_000)}`)).toBeVisible();
});

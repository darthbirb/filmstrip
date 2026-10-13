import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { folderItems, moveItems, restoreItems, trashItems, undoLast } from "../../ipc/commands";
import { formatBytes } from "../../lib/format";
import { libraryChanged } from "../library";
import { Foot } from "./Foot";
import { loadIndex, resetIndex } from "./index-store";

// Against the dev mock: Pictures holds six files, Incoming three, each 2,400,000 bytes.

const line = (files: number) => `${files} items · ${formatBytes(files * 2_400_000)}`;

beforeEach(async () => {
  while (await undoLast()) {}
  resetIndex();
  await loadIndex();
});

test("the counts move the moment a move, a delete or a restore lands, with nothing to reload", async () => {
  const screen = await render(<Foot />);
  const foot = screen.getByRole("button", { name: /items · / });
  await expect.poll(() => foot.element().lastElementChild?.textContent).toBe(line(6));
  await foot.click();
  const totals = screen.getByRole("dialog", { name: "Library" });
  const row = (label: string) =>
    totals.getByText(label, { exact: true }).element().nextElementSibling?.textContent;
  await expect.poll(() => row("Sorting Box")).toBe("3");
  expect(row("Trash")).toBe("0");

  const cairo = (await folderItems(6)).map((item) => item.id);
  await trashItems(cairo.slice(0, 2));
  await libraryChanged();
  await expect.poll(() => foot.element().lastElementChild?.textContent).toBe(line(4));
  await expect.poll(() => row("Trash")).toBe("2");
  await expect.poll(() => row("In All")).toBe("4");

  const [waiting] = (await folderItems(2)).map((item) => item.id);
  await moveItems([waiting as number], 6);
  await libraryChanged();
  await expect.poll(() => foot.element().lastElementChild?.textContent).toBe(line(5));
  await expect.poll(() => row("Sorting Box")).toBe("2");

  await restoreItems(cairo.slice(0, 2), null);
  await libraryChanged();
  await expect.poll(() => foot.element().lastElementChild?.textContent).toBe(line(7));
  await expect.poll(() => row("Trash")).toBe("0");
});

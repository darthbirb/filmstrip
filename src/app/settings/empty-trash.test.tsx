import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { holdOpen, resetTrashLimits } from "../../dev/mock";
import { folderItems, trashItems, trashLimits, undoLast } from "../../ipc/commands";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { setPlace } from "../place";
import { Settings } from "./Settings";
import { getEmptying } from "./settings-store";

// Against the dev mock, whose files are each 2,400,000 bytes; Cairo (6) holds a few.

beforeEach(async () => {
  await page.viewport(1280, 820);
  while (await undoLast()) {}
  resetTrashLimits();
  setNews(null);
  setPlace({ kind: "sorting" });
  resetIndex();
  await loadIndex();
});

const opened = () =>
  render(
    <>
      <Settings open onClose={() => undefined} section="trash" />
      <Foot />
    </>,
  );
const emptyButton = () => page.getByRole("button", { name: "Empty Trash…" });
const head = () => document.querySelector("dialog section header")?.textContent ?? "";

async function trashTwo() {
  const ids = (await folderItems(6)).map((row) => row.id).slice(0, 2);
  await trashItems(ids);
  return ids as [number, number];
}

test("Empty Trash… is in the head only while the Trash holds something", async () => {
  const screen = await opened();
  await expect.element(screen.getByText("Nothing in it")).toBeVisible();
  expect(emptyButton().query()).toBeNull();

  screen.unmount();
  await trashTwo();
  await opened();
  await expect.element(emptyButton()).toBeVisible();
  expect(head()).toContain("2 files · 4.6 MB of 25 GB");
});

test("it asks how many and how much, with the focus on Cancel, and Escape puts the question away", async () => {
  await trashTwo();
  await opened();
  await userEvent.click(emptyButton());
  await expect
    .element(
      page.getByText(
        "Delete the 2 files in the Trash, 4.6 MB, for good? They do not go to the Recycle Bin, and Undo cannot bring them back.",
      ),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Empty Trash", exact: true }))
    .toBeVisible();
  expect(document.activeElement?.textContent).toBe("Cancel");

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.querySelector("dialog[open]")).not.toBeNull();
  await expect
    .element(page.getByRole("button", { name: "Empty Trash", exact: true }))
    .not.toBeInTheDocument();
  expect(document.activeElement?.textContent).toBe("Empty Trash…");
  expect((await trashLimits()).held.count).toBe(2);
});

test("emptying counts in the head, then the foot says it went for good, with no Undo", async () => {
  await trashTwo();
  await opened();
  await userEvent.click(emptyButton());
  await userEvent.click(page.getByRole("button", { name: "Empty Trash", exact: true }));
  await expect.poll(head).toMatch(/Emptying · [01] of 2 files/);
  expect(emptyButton().query()).toBeNull();
  expect(document.querySelector("dialog section header [class*='w-head-progress']")).not.toBeNull();

  await expect
    .element(page.getByText("Emptied the Trash: 2 files, 4.6 MB, deleted for good."))
    .toBeVisible();
  expect(getEmptying()).toBeNull();
  await expect.poll(head).toContain("Nothing in it");
  expect(emptyButton().query()).toBeNull();
  expect(page.getByRole("button", { name: "Undo" }).query()).toBeNull();
  expect((await trashLimits()).held.count).toBe(0);
  expect(await undoLast()).toBeNull();
});

test("a file another app has open stays in the Trash, and the foot says so with the way to it", async () => {
  const [, open] = await trashTwo();
  holdOpen([open]);
  await opened();
  await userEvent.click(emptyButton());
  await userEvent.click(page.getByRole("button", { name: "Empty Trash", exact: true }));

  await expect
    .element(
      page.getByText("Deleted 1 of 2 files. 1 is open in another app and stays in the Trash."),
    )
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Show in Trash" })).toBeVisible();
  await expect.poll(head).toContain("1 file · 2.3 MB of 25 GB");
  await expect.element(emptyButton()).toBeVisible();
  expect((await trashLimits()).held.count).toBe(1);
});

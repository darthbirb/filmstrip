import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import { clipboardFiles, copyItems, folderItems, undoLast } from "../../ipc/commands";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { openFolders, setOpenFolders } from "../navigation/open-folders";
import { readClipboard, resetClipboard } from "./clipboard";

// Against the dev mock: Pictures holds cover.jpg, People (5) and Trips (4); Incoming (2) is the
// one sorting source. Its Copy puts the files' paths on the mock's clipboard.

beforeEach(async () => {
  while (await undoLast()) {}
  setNews(null);
  resetIndex();
  await loadIndex();
  setOpenFolders(new Set());
  openFolders([1]);
  resetClipboard();
});

async function renderTree() {
  await page.viewport(1000, 700);
  render(
    <nav style={{ width: 260 }}>
      <Navigation />
    </nav>,
  );
  await expect.element(row(/^People /)).toBeVisible();
}

const row = (name: RegExp) => page.getByRole("treeitem", { name });

async function menuOf(name: RegExp) {
  await row(name).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect.element(menu).toBeVisible();
  // Each row's glyph is a character of its own, which the label is read without.
  return [...menu.element().querySelectorAll("[role=menuitem]")].map((one) =>
    one.textContent?.replace(/[\uE000-\uF8FF]/g, "").trim(),
  );
}

/** cover.jpg on the clipboard, as the app's own Copy puts it there. */
async function copyCover() {
  const [cover] = await folderItems(1);
  await copyItems([cover?.id ?? 0]);
  expect(await clipboardFiles()).toEqual({ files: 1, folders: 0 });
  await readClipboard();
}

test("with no files on the clipboard Paste is absent, and the Sorting Box's row opens nothing", async () => {
  await readClipboard();
  await renderTree();
  expect(await menuOf(/^People /)).not.toContain("Paste 1 File");
  await userEvent.keyboard("{Escape}");

  await row(/^Sorting Box /).click({ button: "right" });
  expect(document.querySelector("[role=menu]")).toBeNull();
});

test("Paste follows New Folder counting what the clipboard holds, and the Box's row has it alone", async () => {
  await copyCover();
  await renderTree();
  const people = await menuOf(/^People /);
  expect(people.slice(0, 3)).toEqual(["Show in Pane", "New Folder", "Paste 1 File"]);
  await userEvent.keyboard("{Escape}");

  expect(await menuOf(/^Sorting Box /)).toEqual(["Paste 1 File"]);
  await recording(async (calls) => {
    await page.getByRole("menuitem", { name: "Paste 1 File" }).click();
    await expect.poll(() => calls).toContainEqual(["paste_files", { folderId: 2 }]);
  });
});

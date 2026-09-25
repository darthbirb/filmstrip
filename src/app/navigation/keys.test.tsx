import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  deleteFolder,
  destinationKeys,
  removeDestinationKey,
  setDestinationKey,
  undoLast,
} from "../../ipc/commands";
import { setPlace } from "../place";
import { loadIndex, refreshIndex, resetIndex } from "./index-store";
import { Navigation } from "./Navigation";
import { openFolders } from "./open-folders";

// Against the dev mock: Pictures (1) holds People (5) and Trips (4), and Trips holds Cairo (6).

beforeEach(async () => {
  while (await undoLast()) {}
  for (const one of await destinationKeys()) await removeDestinationKey(one.key);
  resetIndex();
  await loadIndex();
  openFolders([1, 4]);
  setPlace({ kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] });
});

/** Binds keys behind the app's back, then reads the index again, as binding in the app does. */
async function bound(...pairs: [string, number][]) {
  for (const [key, folder] of pairs) await setDestinationKey(key, folder);
  await refreshIndex();
}

async function renderTree() {
  await render(
    <div style={{ width: 280 }}>
      <Navigation />
    </div>,
  );
  await expect.element(page.getByRole("treeitem", { name: /^Trips/ })).toBeVisible();
}

const row = (name: string) => page.getByRole("treeitem", { name, exact: true });
const chipOn = (name: string) =>
  row(name).element().querySelector("[title^='Destination Key']")?.textContent ?? null;
const openKeys = async (name: string) => {
  await userEvent.click(row(name), { button: "right" });
  await userEvent.click(page.getByRole("menuitem", { name: /^Assign Key…/ }));
};

test("a bound folder's row carries its key beside the count", async () => {
  await bound(["2", 6]);
  await renderTree();
  await expect.poll(() => chipOn("Cairo 3")).toBe("2");
  expect(chipOn("Trips 2")).toBeNull();
});

test("Assign Key… opens the ten keys and No Key, and picking one binds it", async () => {
  await bound(["2", 6]);
  await renderTree();
  await openKeys("Trips 2");

  const menu = page.getByRole("menu", { name: "Key for Trips" });
  await expect.element(menu).toBeVisible();
  const items = menu.getByRole("menuitem").elements();
  expect(items).toHaveLength(11);
  expect(items[1]?.textContent).toContain("Cairo");
  expect(items[0]?.textContent).toContain("Free");
  expect(items[10]?.textContent).toContain("No Key");

  await userEvent.click(menu.getByRole("menuitem").nth(0));
  await expect.poll(() => chipOn("Trips 2")).toBe("1");
  expect((await destinationKeys()).map((one) => [one.key, one.folderId])).toEqual([
    ["1", 4],
    ["2", 6],
  ]);
});

test("a folder's own key is plated in its menu, and trails its Assign Key… row", async () => {
  await bound(["3", 4]);
  await renderTree();
  await userEvent.click(row("Trips 2"), { button: "right" });
  const assign = page.getByRole("menuitem", { name: /^Assign Key…/ });
  // After the keyboard glyph's own character: the words, then the key Trips holds now.
  expect(assign.element().textContent?.endsWith("Assign Key…3")).toBe(true);
  await userEvent.click(assign);
  const own = page.getByRole("menu", { name: "Key for Trips" }).getByRole("menuitem").nth(2);
  expect(own.element().className).toContain("bg-plate");
});

test("picking a key another folder holds moves it, and No Key frees the folder's own", async () => {
  await bound(["2", 6]);
  await renderTree();
  await openKeys("Trips 2");
  await userEvent.click(page.getByRole("menu").getByRole("menuitem").nth(1));
  await expect.poll(() => chipOn("Trips 2")).toBe("2");
  expect(chipOn("Cairo 3")).toBeNull();

  await openKeys("Trips 2");
  await userEvent.click(page.getByRole("menuitem", { name: "No Key" }));
  await expect.poll(() => chipOn("Trips 2")).toBeNull();
  expect(await destinationKeys()).toEqual([]);
});

test("a key whose folder has gone says so in the menu, and its folder has no row to carry it", async () => {
  await setDestinationKey("4", 6);
  await deleteFolder(6, { kind: "trash" });
  await refreshIndex();
  await renderTree();
  await openKeys("Trips 2");
  const gone = page.getByRole("menu", { name: "Key for Trips" }).getByRole("menuitem").nth(3);
  expect(gone.element().textContent).toContain("Cairo · gone");
});

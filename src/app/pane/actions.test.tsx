import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeAll, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { folderItems, itemDetail } from "../../ipc/commands";
import { Actions } from "./Actions";

// Read from the dev mock before any test replaces it with a recorder.
let sample: ItemDetail;
beforeAll(async () => {
  const [first] = await folderItems(6);
  if (!first) throw new Error("the mock has nothing in Cairo");
  sample = (await itemDetail(first.id)) as ItemDetail;
});

let sent: { cmd: string; payload: unknown }[] = [];

beforeEach(() => {
  sent = [];
  mockIPC((cmd, payload) => {
    sent.push({ cmd, payload });
    return null;
  });
});

/** The bar at a width the pane might give it. */
async function renderBar(width: number) {
  await page.viewport(1000, 700);
  return render(
    <div style={{ width }}>
      <Actions item={sample} />
    </div>,
  );
}

test("each button does its own thing to the file the pane is showing", async () => {
  const screen = await renderBar(400);
  await screen.getByRole("button", { name: "Show in Explorer" }).click();
  await screen.getByRole("button", { name: "Copy" }).click();
  await screen.getByRole("button", { name: "Open with Default App" }).click();

  expect(sent.map((call) => call.cmd)).toEqual(["reveal_item", "copy_items", "open_item"]);
  expect(sent[0]?.payload).toEqual({ itemId: sample.id });
  await expect.element(screen.getByRole("button", { name: "Move to…" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Delete" })).toBeVisible();
});

test("Delete stays beside the ⋯ when the other glyph buttons have left the bar", async () => {
  const screen = await renderBar(200);
  await expect.element(screen.getByRole("button", { name: "Delete" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Show in Explorer" }).elements()).toHaveLength(0);
  await expect.element(screen.getByRole("button", { name: "More" })).toBeVisible();
});

test("favourite reports itself, and says so without a hue", async () => {
  const screen = await renderBar(400);
  await screen.getByRole("button", { name: "Favourite" }).click();

  expect(sent.at(-1)).toEqual({
    cmd: "set_item_favorite",
    payload: { itemIds: [sample.id], favorite: true },
  });
  const marked = screen.getByRole("button", { name: "Remove Favourite" });
  await expect.element(marked).toHaveAttribute("aria-pressed", "true");
  // The state is carried by the filled glyph and the plate, never by a colour this app does not have.
  expect(marked.element().querySelector(".glyph-fill")).not.toBeNull();
});

test("what does not fit moves into the menu, and stays out of the bar", async () => {
  const screen = await renderBar(280);
  await expect.element(screen.getByRole("button", { name: "Show in Explorer" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy" }).elements()).toHaveLength(0);

  await screen.getByRole("button", { name: "More" }).click();
  const menu = screen.getByRole("menu", { name: "More" });
  await expect.element(menu.getByRole("menuitem", { name: "Copy" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Open with Default App" }).click();
  expect(sent.map((call) => call.cmd)).toEqual(["open_item"]);
});

test("with room for all of them the menu holds Rename alone", async () => {
  const screen = await renderBar(400);
  await expect.element(screen.getByRole("button", { name: "Open with Default App" })).toBeVisible();
  await screen.getByRole("button", { name: "More" }).click();
  const menu = screen.getByRole("menu", { name: "More" });
  expect(
    menu
      .getByRole("menuitem")
      .elements()
      .map((row) => row.textContent),
  ).toEqual([expect.stringContaining("Rename")]);
});

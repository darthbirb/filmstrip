import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { setPlace } from "../place";
import { getPreferences, updatePreferences } from "../preferences";
import { Grid } from "./Grid";
import { TileSize } from "./TileSize";

const items: ItemRow[] = Array.from({ length: 12 }, (_, n) => ({
  id: n + 1,
  uuid: `item-${n}`,
  folderId: 1,
  diskName: `item-${n}.png`,
  ext: "png",
  kind: "image",
  sizeBytes: 1,
  mtime: 0,
  width: 800,
  height: 600,
  durationMs: null,
  favorite: false,
  thumb: null,
}));

const side = () => Number.parseFloat(document.querySelector("figure")?.style.width ?? "0");

beforeEach(() => {
  setPlace({ kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] });
  mockIPC((cmd) => (cmd === "folder_items" ? items : undefined), { shouldMockEvents: true });
  updatePreferences({ tile: undefined });
});

test("the tile size is one of four named steps, and the grid follows the one chosen", async () => {
  await page.viewport(1000, 700);
  const screen = await render(
    <div style={{ display: "flex", flexDirection: "column", width: 1000, height: 600 }}>
      <TileSize />
      <Grid mode="uniform" />
    </div>,
  );
  await expect.poll(side).toBeGreaterThan(0);
  const medium = side();

  await screen.getByRole("button", { name: "Tile Size: Medium" }).click();
  const steps = screen.getByRole("listbox", { name: "Tile Size" }).getByRole("option");
  expect(steps.elements().map((step) => step.textContent)).toEqual([
    "Small",
    "Medium",
    "Large",
    "Extra Large",
  ]);

  await screen.getByRole("option", { name: "Large" }).click();
  await expect.poll(side).toBeGreaterThan(medium);
  expect(getPreferences().tile).toBe(15);
});

test("a size saved before the steps existed lands on the nearest one", async () => {
  updatePreferences({ tile: 10 });
  const screen = await render(<TileSize />);
  await expect.element(screen.getByRole("button", { name: "Tile Size: Medium" })).toBeVisible();

  updatePreferences({ tile: 19 });
  await expect
    .element(screen.getByRole("button", { name: "Tile Size: Extra Large" }))
    .toBeVisible();
});

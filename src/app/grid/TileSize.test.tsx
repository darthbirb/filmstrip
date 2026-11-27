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
  scrub: null,
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

test("Ctrl+wheel over the grid steps the tile size and saves it, a touchpad's small turns gathered", async () => {
  await page.viewport(1000, 700);
  const screen = await render(
    <div style={{ display: "flex", flexDirection: "column", width: 1000, height: 600 }}>
      <TileSize />
      <div data-testid="grid" style={{ flex: 1, minHeight: 0 }}>
        <Grid mode="uniform" />
      </div>
    </div>,
  );
  await expect.poll(side).toBeGreaterThan(0);
  const over = screen.getByTestId("grid").getByRole("button").first().element();
  const turn = (deltaY: number, ctrlKey = true) => {
    const wheel = new WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true });
    over.dispatchEvent(wheel);
    return wheel.defaultPrevented;
  };

  expect(turn(-100)).toBe(true);
  await expect.element(screen.getByRole("button", { name: "Tile Size: Large" })).toBeVisible();
  expect(getPreferences().tile).toBe(15);
  turn(-100);
  turn(-100);
  expect(getPreferences().tile).toBe(20);

  for (let n = 0; n < 4; n += 1) turn(10);
  expect(getPreferences().tile).toBe(20);
  turn(10);
  await expect.element(screen.getByRole("button", { name: "Tile Size: Large" })).toBeVisible();

  expect(turn(100, false)).toBe(false);
  expect(getPreferences().tile).toBe(15);
});

test("a wheel that turns in lines steps the tile size once a notch", async () => {
  await page.viewport(1000, 700);
  const screen = await render(
    <div style={{ display: "flex", flexDirection: "column", width: 1000, height: 600 }}>
      <TileSize />
      <div data-testid="grid" style={{ flex: 1, minHeight: 0 }}>
        <Grid mode="uniform" />
      </div>
    </div>,
  );
  await expect.poll(side).toBeGreaterThan(0);
  const over = screen.getByTestId("grid").getByRole("button").first().element();
  const notch = (deltaY: number) =>
    over.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

  notch(-1);
  expect(getPreferences().tile).toBe(15);
  notch(3);
  notch(3);
  await expect.element(screen.getByRole("button", { name: "Tile Size: Small" })).toBeVisible();
});

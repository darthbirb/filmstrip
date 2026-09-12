import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { setPlace } from "../place";
import { getPreferences, updatePreferences, usePreferences } from "../preferences";
import { Grid } from "./Grid";
import { LayoutToggle } from "./LayoutToggle";
import { DEFAULT_LAYOUT } from "./layout";

const SHAPES = [
  [900, 600],
  [600, 900],
  [1400, 500],
];

const items: ItemRow[] = Array.from({ length: 12 }, (_, n) => {
  const [width, height] = SHAPES[n % SHAPES.length] as [number, number];
  return {
    id: n + 1,
    uuid: `item-${n}`,
    folderId: 1,
    diskName: `item-${n}.png`,
    ext: "png",
    kind: "image",
    sizeBytes: 1,
    mtime: 0,
    width,
    height,
    durationMs: null,
    favorite: false,
    thumb: null,
  };
});

/** The toggle and the grid, joined by the saved preference as the app joins them. */
function Harness() {
  const layout = usePreferences().layout ?? DEFAULT_LAYOUT;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 1000, height: 600 }}>
      <LayoutToggle />
      <Grid mode={layout} />
    </div>
  );
}

const widths = () =>
  [...document.querySelectorAll("figure")].map((tile) => (tile as HTMLElement).style.width);

beforeEach(() => {
  setPlace({ kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] });
  mockIPC((cmd) => (cmd === "folder_items" ? items : undefined), { shouldMockEvents: true });
  updatePreferences({ layout: undefined });
});

test("rows are the default, and the toggle switches to squares and remembers it", async () => {
  await page.viewport(1000, 700);
  const screen = await render(<Harness />);
  await expect.poll(() => widths().length).toBe(12);
  await expect
    .element(screen.getByRole("button", { name: "Rows" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(new Set(widths()).size).toBeGreaterThan(1);

  await screen.getByRole("button", { name: "Squares" }).click();
  await expect.poll(() => new Set(widths()).size).toBe(1);
  expect(getPreferences().layout).toBe("uniform");
});

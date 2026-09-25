import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { Trashed } from "../../ipc/bindings/Trashed";
import { setPlace } from "../place";
import { Grid } from "./Grid";

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;

function trashed(id: number, at: number, path: string[], gone = false): Trashed {
  return {
    id,
    uuid: `item-${id}`,
    folderId: id,
    diskName: `IMG_00${id}.jpg`,
    ext: "jpg",
    kind: "image",
    sizeBytes: 1,
    mtime: 0,
    width: 4000,
    height: 3000,
    durationMs: null,
    favorite: false,
    thumb: null,
    trashedAt: at,
    from: { folderId: id, path, gone },
  };
}

// Newest first, as the Trash lists them: two from today, one from yesterday whose folder is gone.
const HELD = [
  trashed(31, now, ["Pictures", "Trips", "Cairo"]),
  trashed(32, now - 1, ["Pictures", "Trips", "Cairo"]),
  trashed(52, now - DAY, ["Pictures", "Trips", "Egypt"], true),
];

// A file in a folder, as a folder lists it: no moment it went, no folder it left.
const { trashedAt: _, from: __, ...IN_FOLDER } = trashed(31, now, []);

beforeEach(async () => {
  mockIPC(
    (cmd) => (cmd === "trash_listing" ? HELD : cmd === "folder_items" ? [IN_FOLDER] : undefined),
    { shouldMockEvents: true },
  );
  setPlace({ kind: "trash" });
  await page.viewport(1000, 700);
});

const box = (element: Element) => element.getBoundingClientRect();

test("the Trash runs newest first under a heading for each day it went", async () => {
  const screen = await render(
    <div style={{ width: 1000, height: 600 }}>
      <Grid mode="justified" />
    </div>,
  );
  const today = screen.getByRole("heading", { name: "Today" });
  const yesterday = screen.getByRole("heading", { name: "Yesterday" });
  await expect.element(yesterday).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "IMG_0052.jpg" })).toBeVisible();

  const first = screen.getByRole("button", { name: "IMG_0031.jpg" }).element();
  const last = screen.getByRole("button", { name: "IMG_0052.jpg" }).element();
  expect(box(today.element()).bottom).toBeLessThanOrEqual(box(first).top);
  expect(box(yesterday.element()).bottom).toBeLessThanOrEqual(box(last).top);
  // A day starts a row of its own, even with room left on the row above.
  expect(box(last).left).toBeLessThan(box(first).right);
});

test("each tile says the folder it came from under it, the whole path in its tooltip, and gone when it is", async () => {
  const screen = await render(
    <div style={{ width: 1000, height: 600 }}>
      <Grid mode="uniform" />
    </div>,
  );
  const tile = screen.getByRole("button", { name: "IMG_0031.jpg" });
  await expect.element(tile).toBeVisible();
  const figure = tile.element().closest("figure");
  const caption = figure?.querySelector("figcaption");
  expect(caption?.textContent).toBe("Cairo");
  expect(caption?.getAttribute("title")).toBe("Pictures › Trips › Cairo");
  expect(box(caption as Element).top).toBeGreaterThanOrEqual(box(tile.element()).bottom);

  const gone = screen.getByRole("button", { name: "IMG_0052.jpg" }).element();
  expect(gone.closest("figure")?.querySelector("figcaption")?.textContent).toBe("Egypt · gone");
});

test("going to the Trash from a folder draws the Trash, not the folder's files under its days", async () => {
  setPlace({ kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] });
  const errors: unknown[] = [];
  const caught = (event: ErrorEvent) => errors.push(event.error);
  window.addEventListener("error", caught);
  try {
    const screen = await render(
      <div style={{ width: 1000, height: 600 }}>
        <Grid mode="justified" />
      </div>,
    );
    await expect.element(screen.getByRole("button", { name: "IMG_0031.jpg" })).toBeVisible();
    setPlace({ kind: "trash" });
    await expect.element(screen.getByRole("heading", { name: "Yesterday" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    window.removeEventListener("error", caught);
  }
});

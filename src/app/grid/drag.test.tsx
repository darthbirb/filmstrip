import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import { folderItems, undoLast } from "../../ipc/commands";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { openFolders, setOpenFolders } from "../navigation/open-folders";
import { getPaneItem, showInPane } from "../pane/pane-store";
import { type Place, setPlace } from "../place";
import { showReport } from "../undo/report-store";
import { Dragging } from "./drag";
import { Grid } from "./Grid";
import { clearChecked, getSelection } from "./selection";

// Against the dev mock: Pictures holds People (5, empty) and Trips (4), and Trips holds Cairo (6),
// whose files are felucca.mp4, pyramid.jpg and sphinx.jpg; Incoming is the one sorting source,
// and Archive is away.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

beforeEach(async () => {
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  resetIndex();
  await loadIndex();
  setOpenFolders(new Set());
  openFolders([1, 4]);
  setPlace(CAIRO);
  clearChecked();
  showInPane(null);
});

async function renderBoth() {
  await page.viewport(1200, 800);
  render(
    <>
      <div style={{ display: "flex", height: 600 }}>
        <nav style={{ width: 260, overflow: "auto" }}>
          <Navigation />
        </nav>
        <div style={{ width: 800 }}>
          <Grid mode="uniform" />
        </div>
      </div>
      <Dragging />
    </>,
  );
  await expect.element(tile("sphinx.jpg")).toBeVisible();
  await expect.element(row("People")).toBeVisible();
}

const tile = (name: string) => page.getByRole("button", { name, exact: true });
const row = (name: string) => page.getByRole("treeitem", { name, exact: true });
const idOf = async (name: string) =>
  (await folderItems(6)).find((file) => file.diskName === name)?.id ?? -1;

const centre = (element: Element) => {
  const box = element.getBoundingClientRect();
  return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
};
const pointer = (type: string, at: object) =>
  new PointerEvent(type, { ...at, button: 0, bubbles: true, pointerId: 1 });

/** Presses on a tile and moves onto a row, as a hand would, and leaves the button down. */
async function dragOnto(file: string, place: string) {
  const from = tile(file).element();
  const to = row(place).element();
  from.dispatchEvent(pointer("pointerdown", centre(from)));
  window.dispatchEvent(pointer("pointermove", centre(to)));
  window.dispatchEvent(pointer("pointermove", centre(to)));
}
const letGo = () => window.dispatchEvent(pointer("pointerup", {}));
const ghost = () => document.querySelector<HTMLElement>(".fixed[aria-hidden=true]");

test("a tile dragged onto a folder says the move before the drop, and the drop is that move", async () => {
  await renderBoth();
  const pyramid = await idOf("pyramid.jpg");
  await dragOnto("pyramid.jpg", "People");
  expect(ghost()?.textContent).toBe("Move 1 file to People");
  await recording(async (calls) => {
    letGo();
    await expect
      .poll(() => calls.find(([cmd]) => cmd === "move_items")?.[1])
      .toEqual({ itemIds: [pyramid], folderId: 5 });
  });
  expect(ghost()).toBeNull();
});

test("a checked tile carries the whole set, and an unchecked one only itself", async () => {
  await renderBoth();
  const [felucca, pyramid] = [await idOf("felucca.mp4"), await idOf("pyramid.jpg")];
  await userEvent.click(page.getByRole("checkbox", { name: "Check felucca.mp4" }));
  await userEvent.click(page.getByRole("checkbox", { name: "Check pyramid.jpg" }));

  await dragOnto("pyramid.jpg", "People");
  expect(ghost()?.textContent).toBe("Move 2 files to People");
  // Escape is the drag's while it is on: the ghost goes and the set stays.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(getSelection().ids).toEqual([felucca, pyramid]);

  await dragOnto("sphinx.jpg", "People");
  expect(ghost()?.textContent).toBe("Move 1 file to People");
  letGo();
  expect(getSelection().ids).toEqual([felucca, pyramid]);
});

test("a row that refuses says why, after the prohibit, and a drop there moves nothing", async () => {
  await renderBoth();
  await recording(async (calls) => {
    for (const [place, why] of [
      ["Cairo 3", "Already in Cairo"],
      ["Trash", "Delete sends to the Trash"],
      ["Archive offline", "Archive is offline"],
    ] as const) {
      await dragOnto("sphinx.jpg", place);
      expect(ghost()?.textContent).toContain(why);
      expect(ghost()?.querySelector("[data-icon=prohibit]")).not.toBeNull();
      expect(document.documentElement.dataset.drag).toBe("refused");
      letGo();
    }
    expect(calls.some(([cmd]) => cmd === "move_items")).toBe(false);
  });
  expect(document.documentElement.dataset.drag).toBeUndefined();
});

test("with one sorting source the Sorting Box takes a drop, and names it", async () => {
  await renderBoth();
  await dragOnto("sphinx.jpg", "Sorting Box 3");
  expect(ghost()?.textContent).toBe("Move 1 file to Incoming");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

test("Escape puts the ghost away and moves nothing", async () => {
  await renderBoth();
  await recording(async (calls) => {
    await dragOnto("sphinx.jpg", "People");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect.poll(ghost).toBeNull();
    letGo();
    expect(calls.some(([cmd]) => cmd === "move_items")).toBe(false);
  });
});

test("a press that moves less than a tile-gap is a click, and shows the picture", async () => {
  await renderBoth();
  await userEvent.click(tile("sphinx.jpg"));
  expect(ghost()).toBeNull();
  expect(getPaneItem()).toBe(await idOf("sphinx.jpg"));
});

test("held on a closed folder for the hold, the ghost opens it", async () => {
  setOpenFolders(new Set([1]));
  await renderBoth();
  await expect.element(row("Trips 2")).toHaveAttribute("aria-expanded", "false");
  await dragOnto("sphinx.jpg", "Trips 2");
  expect(ghost()?.textContent).toBe("Move 1 file to Trips");
  await expect.element(row("Trips 2")).toHaveAttribute("aria-expanded", "true");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

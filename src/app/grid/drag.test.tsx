import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import { folderItems, undoLast } from "../../ipc/commands";
import { getNews, setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { openFolders, setOpenFolders } from "../navigation/open-folders";
import {
  addToPane,
  getPaneItem,
  getPaneOrigin,
  getPaneSet,
  paneSetLimit,
  showInPane,
} from "../pane/pane-store";
import { type Place, setPlace } from "../place";
import { showReport } from "../undo/report-store";
import { Dragging, PaneDropRing, scrollTreeNear } from "./drag";
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
  await expect.element(row("People 0 of 0")).toBeVisible();
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
  await dragOnto("pyramid.jpg", "People 0 of 0");
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

  await dragOnto("pyramid.jpg", "People 0 of 0");
  expect(ghost()?.textContent).toBe("Move 2 files to People");
  // Escape is the drag's while it is on: the ghost goes and the set stays.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(getSelection().ids).toEqual([felucca, pyramid]);

  await dragOnto("sphinx.jpg", "People 0 of 0");
  expect(ghost()?.textContent).toBe("Move 1 file to People");
  letGo();
  expect(getSelection().ids).toEqual([felucca, pyramid]);
});

test("a row that refuses says why, after the prohibit, and a drop there moves nothing", async () => {
  await renderBoth();
  await recording(async (calls) => {
    for (const [place, why] of [
      ["Cairo 3 of 3", "Already in Cairo"],
      ["Trash 0 of 0", "Delete sends to the Trash"],
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
  await dragOnto("sphinx.jpg", "Sorting Box 3 of 3");
  expect(ghost()?.textContent).toBe("Move 1 file to Incoming");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

test("Escape puts the ghost away and moves nothing", async () => {
  await renderBoth();
  await recording(async (calls) => {
    await dragOnto("sphinx.jpg", "People 0 of 0");
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
  await expect.element(row("Trips 2 of 5")).toHaveAttribute("aria-expanded", "false");
  await dragOnto("sphinx.jpg", "Trips 2 of 5");
  expect(ghost()?.textContent).toBe("Move 1 file to Trips");
  await expect.element(row("Trips 2 of 5")).toHaveAttribute("aria-expanded", "true");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

test("a set dragged by a later-checked tile wears the pressed tile's picture", async () => {
  await renderBoth();
  await userEvent.click(page.getByRole("checkbox", { name: "Check pyramid.jpg" }));
  await userEvent.click(page.getByRole("checkbox", { name: "Check sphinx.jpg" }));
  const pictureOf = (name: string) =>
    tile(name).element().querySelector("img")?.getAttribute("src");
  const sphinx = pictureOf("sphinx.jpg");
  expect(sphinx).toBeTruthy();
  expect(pictureOf("pyramid.jpg")).not.toBe(sphinx);

  await dragOnto("sphinx.jpg", "People 0 of 0");
  expect(ghost()?.textContent).toBe("Move 2 files to People");
  expect(ghost()?.querySelector("img")?.getAttribute("src")).toBe(sphinx);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

test("a branch dragged by a tile it lists wears that tile's picture", async () => {
  await renderBoth();
  await row("Pictures 1 of 6").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Select Everything Inside" }).click();
  await expect.element(tile("cover.jpg")).toBeVisible();
  await expect.poll(() => getSelection().ids).toHaveLength(6);
  const picture = tile("cover.jpg").element().querySelector("img")?.getAttribute("src");
  expect(picture).toBeTruthy();

  await dragOnto("cover.jpg", "People 0 of 0");
  expect(ghost()?.textContent).toBe("Move 6 files to People");
  expect(ghost()?.querySelector("img")?.getAttribute("src")).toBe(picture);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

/** The grid beside a stand-in pane at the window's right edge, taking a drop as the open pane does. */
async function renderWithPane() {
  await page.viewport(1200, 800);
  render(
    <>
      <div style={{ display: "flex", height: 600 }}>
        <div style={{ flex: 1 }}>
          <Grid mode="uniform" />
        </div>
        <aside aria-label="Pane" data-drop="pane" style={{ position: "relative", width: 320 }}>
          <p>pane</p>
          <PaneDropRing />
        </aside>
      </div>
      <Dragging />
    </>,
  );
  await expect.element(tile("sphinx.jpg")).toBeVisible();
}

/** Presses on a tile and moves onto the pane, and leaves the button down. */
async function dragToPane(file: string) {
  const from = tile(file).element();
  const to = page.getByRole("complementary", { name: "Pane" }).element();
  from.dispatchEvent(pointer("pointerdown", centre(from)));
  window.dispatchEvent(pointer("pointermove", centre(to)));
  window.dispatchEvent(pointer("pointermove", centre(to)));
}
const lit = () => document.querySelector("[data-pane-lit]") !== null;

test("a tile dragged onto the pane lights it and is added after what it shows", async () => {
  await renderWithPane();
  const [pyramid, sphinx] = [await idOf("pyramid.jpg"), await idOf("sphinx.jpg")];
  showInPane(pyramid, CAIRO);
  await dragToPane("sphinx.jpg");
  expect(ghost()?.textContent).toBe("Add 1 file to the pane");
  expect(lit()).toBe(true);
  letGo();
  expect(getPaneSet()).toEqual([pyramid, sphinx]);
  await expect.poll(lit).toBe(false);
  expect(getNews()).toBeNull();
});

test("over the pane at the window's right edge the ghost sits to the pointer's left", async () => {
  await renderWithPane();
  showInPane(await idOf("pyramid.jpg"), CAIRO);
  await dragToPane("sphinx.jpg");
  const pane = page.getByRole("complementary", { name: "Pane" }).element();
  const box = ghost()?.getBoundingClientRect();
  letGo();
  expect(box?.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
  expect(box?.right).toBeLessThan(centre(pane).clientX);
  expect(box?.left).toBeGreaterThan(0);
});

test("over an empty pane a set is shown in its place, in the order carried", async () => {
  await renderWithPane();
  const [felucca, sphinx] = [await idOf("felucca.mp4"), await idOf("sphinx.jpg")];
  await userEvent.click(page.getByRole("checkbox", { name: "Check sphinx.jpg" }));
  await userEvent.click(page.getByRole("checkbox", { name: "Check felucca.mp4" }));
  await dragToPane("sphinx.jpg");
  expect(ghost()?.textContent).toBe("Show 2 files in the pane");
  letGo();
  expect(getPaneSet()).toEqual([sphinx, felucca]);
  expect(getPaneOrigin()).toEqual(CAIRO);
  // The drop leaves the set checked, so Escape in the grid still clears it.
  expect(getSelection().ids).toHaveLength(2);
});

test("files already shown are refused, and a full pane refuses, the pane unlit", async () => {
  await renderWithPane();
  const pyramid = await idOf("pyramid.jpg");
  showInPane(pyramid, CAIRO);
  await dragToPane("pyramid.jpg");
  expect(ghost()?.textContent).toContain("Already in the pane");
  expect(ghost()?.querySelector("[data-icon=prohibit]")).not.toBeNull();
  expect(lit()).toBe(false);
  letGo();
  expect(getPaneSet()).toEqual([pyramid]);

  const limit = paneSetLimit();
  addToPane(
    Array.from({ length: limit - 1 }, (_, at) => 1000 + at),
    CAIRO,
  );
  await dragToPane("sphinx.jpg");
  expect(ghost()?.textContent).toContain(`The pane shows ${limit} at most`);
  expect(lit()).toBe(false);
  letGo();
  expect(getPaneSet()).toHaveLength(limit);
  expect(getNews()).toBeNull();
});

test("past the limit what fits goes in, and the line says how many of how many", async () => {
  await renderWithPane();
  const limit = paneSetLimit();
  const [felucca, pyramid, sphinx] = [
    await idOf("felucca.mp4"),
    await idOf("pyramid.jpg"),
    await idOf("sphinx.jpg"),
  ];
  showInPane(5000, CAIRO);
  addToPane(
    Array.from({ length: limit - 2 }, (_, at) => 1000 + at),
    CAIRO,
  );
  for (const name of ["felucca.mp4", "pyramid.jpg", "sphinx.jpg"]) {
    await userEvent.click(page.getByRole("checkbox", { name: `Check ${name}` }));
  }
  expect(getSelection().ids).toEqual([felucca, pyramid, sphinx]);
  await dragToPane("pyramid.jpg");
  expect(ghost()?.textContent).toBe("Add 1 of 3 files to the pane");
  letGo();
  expect(getPaneSet()).toHaveLength(limit);
  expect(getPaneSet().slice(-1)).toEqual([felucca]);
  expect(getPaneSet()).not.toContain(pyramid);
  expect(getPaneSet()).not.toContain(sphinx);
  expect(getNews()).toEqual({
    kind: "said",
    line: `Added 1 of 3 files to the pane. It shows ${limit} at most.`,
  });
});

test("near the tree's foot it scrolls a row's height a second, at 60 Hz as at 144 Hz", async () => {
  await page.viewport(1200, 800);
  render(
    <nav style={{ width: 260, height: 160, overflow: "auto" }}>
      <Navigation />
    </nav>,
  );
  await expect.element(row("People 0 of 0")).toBeInTheDocument();
  const scroller = document.querySelector("nav");
  if (!scroller) throw new Error("no tree");
  const root = getComputedStyle(document.documentElement);
  const edge =
    Number.parseFloat(root.getPropertyValue("--spacing-row")) * Number.parseFloat(root.fontSize);
  const box = scroller.getBoundingClientRect();
  const foot = { x: box.left + 40, y: box.bottom - edge / 2 };

  const [request, cancel] = [window.requestAnimationFrame, window.cancelAnimationFrame];
  const scrolled = (hz: number) => {
    scroller.scrollTop = 0;
    let queued: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => queued.push(callback);
    window.cancelAnimationFrame = () => {
      queued = [];
    };
    try {
      const stop = scrollTreeNear(
        () => foot,
        () => {},
      );
      for (let frame = 0; frame <= hz; frame += 1) {
        const due = queued;
        queued = [];
        for (const callback of due) callback((frame * 1000) / hz);
      }
      stop();
    } finally {
      window.requestAnimationFrame = request;
      window.cancelAnimationFrame = cancel;
    }
    return scroller.scrollTop;
  };

  expect(Math.abs(scrolled(60) - edge)).toBeLessThanOrEqual(1);
  expect(Math.abs(scrolled(144) - edge)).toBeLessThanOrEqual(1);
});

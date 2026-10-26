import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { clip, serveFiles } from "../../dev/media";
import { recording } from "../../dev/recording";
import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { folderItems, itemDetail, undoLast } from "../../ipc/commands";
import { Frame } from "../frame/Frame";
import { Grid } from "../grid/Grid";
import { clearChecked, toggleChecked } from "../grid/selection";
import { type Place, setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { deleteFiles } from "./delete";
import { getFullScreen, setFullScreen, useEscapeLeavesFullScreen } from "./full-screen";
import { Pane, PaneHeader } from "./Pane";
import { PaneSet } from "./PaneSet";
import { PaneDetailProvider } from "./pane-detail";
import { addToPane, getPaneItem, getPaneSet, showInPane } from "./pane-store";

// Against the dev mock: Cairo holds felucca.mp4 (6000 × 2000), pyramid.jpg (4000 × 3000) and
// sphinx.jpg (3000 × 4000); the Sorting Box holds clip.mp4.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

let cairo: Record<string, ItemRow>;
let undoServe = () => {};

beforeEach(async () => {
  while (await undoLast()) {}
  showInPane(null);
  clearChecked();
  setFullScreen(false);
  updatePreferences({ widths: undefined, hidden: undefined });
  setPlace(CAIRO);
  cairo = Object.fromEntries((await folderItems(6)).map((row) => [row.diskName, row]));
  await page.viewport(1200, 800);
});

afterEach(() => undoServe());

const id = (name: string) => cairo[name]?.id ?? -1;

/** The three of Cairo in the pane: pyramid first, then sphinx and felucca dropped on it. */
function showThree() {
  showInPane(id("pyramid.jpg"), CAIRO);
  addToPane([id("sphinx.jpg"), id("felucca.mp4")], CAIRO);
}

function Harness({ width = 320, height = 640, grid = false }) {
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex", height }}>
        {grid && (
          <main style={{ width: 700 }}>
            <Grid mode="justified" />
          </main>
        )}
        <aside aria-label="Pane" style={{ display: "flex", flexDirection: "column", width }}>
          <PaneHeader />
          <div style={{ flex: 1, minHeight: 0 }}>
            <Pane />
          </div>
        </aside>
      </div>
    </PaneDetailProvider>
  );
}

const files = () => page.getByRole("group", { name: "3 Files" });
const file = (name: string) => files().getByRole("button", { name, exact: true });
/** Tab past the header's Full Screen into the set. */
async function tabIn() {
  await userEvent.tab();
  await userEvent.tab();
}

test("the set draws at one scale inside the area, at every pane size, rows centred", async () => {
  showThree();
  for (const [width, height] of [
    [224, 640],
    [320, 640],
    [640, 480],
    [1000, 700],
  ] as const) {
    const screen = await render(<Harness width={width} height={height} />);
    const area = files();
    await expect.element(area).toBeVisible();
    const box = area.element().getBoundingClientRect();
    const scales: number[] = [];
    for (const name of ["pyramid.jpg", "sphinx.jpg", "felucca.mp4"]) {
      const element = file(name).element();
      await expect.poll(() => element.getBoundingClientRect().width).toBeGreaterThan(0);
      const drawn = element.getBoundingClientRect();
      expect(drawn.left).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(drawn.right).toBeLessThanOrEqual(box.right + 0.5);
      expect(drawn.top).toBeGreaterThanOrEqual(box.top - 0.5);
      expect(drawn.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
      scales.push(drawn.width / (cairo[name]?.width ?? 1));
      // Each row is centred in the area.
      const row = [...area.element().querySelectorAll("[data-file]")].filter((other) => {
        const box = other.getBoundingClientRect();
        return Math.abs(box.top + box.height / 2 - (drawn.top + drawn.height / 2)) < 1;
      });
      const left = Math.min(...row.map((one) => one.getBoundingClientRect().left));
      const right = Math.max(...row.map((one) => one.getBoundingClientRect().right));
      expect(Math.abs(left - box.left - (box.right - right))).toBeLessThan(1);
    }
    for (const scale of scales) expect(scale / (scales[0] ?? 1)).toBeCloseTo(1, 2);
    await screen.unmount();
  }
});

test("a file with no shape stands in at the floor, its extension on the hatch, and counts", async () => {
  const [pyramid, sphinx] = await Promise.all(
    ["pyramid.jpg", "sphinx.jpg"].map((name) => itemDetail(id(name))),
  );
  if (!pyramid || !sphinx) throw new Error("the mock has no pyramid.jpg or sphinx.jpg");
  const notes: ItemDetail = {
    ...pyramid,
    id: 9001,
    uuid: "notes",
    diskName: "notes.pdf",
    ext: "pdf",
    kind: "other",
    width: null,
    height: null,
    thumb: null,
    path: "D:\\Pictures\\Cairo\\notes.pdf",
  };
  await render(
    <div style={{ display: "flex", width: 320, height: 640 }}>
      <PaneSet items={[pyramid, notes, sphinx]} />
    </div>,
  );
  const stand = file("notes.pdf");
  await expect.element(stand.getByText("PDF")).toBeVisible();
  const box = stand.element().getBoundingClientRect();
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  expect(box.width).toBeCloseTo(4 * rem, 0);
  expect(box.height).toBeCloseTo(2.25 * rem, 0);
  await stand.click();
  expect(getPaneSet()).toEqual([9001]);
});

test("the set's files are read in one call, not one call each", async () => {
  await recording(async (calls) => {
    showThree();
    await render(<Harness />);
    await expect.element(file("felucca.mp4")).toBeVisible();
    const each = calls.filter(([cmd]) => cmd === "item_detail").map(([, args]) => args);
    expect(each).toEqual(each.map(() => ({ itemId: id("pyramid.jpg") })));
    expect(calls).toContainEqual([
      "items_detail",
      { itemIds: [id("pyramid.jpg"), id("sphinx.jpg"), id("felucca.mp4")] },
    ]);
  });
});

test("the header counts the files and their size, is no disclosure, and the bar goes", async () => {
  showThree();
  const screen = await render(<Harness />);
  const pane = screen.getByRole("complementary", { name: "Pane" });
  await expect.element(pane.getByText(/^3 Files · 6[.,]9 MB$/)).toBeVisible();
  expect(pane.getByRole("button", { expanded: false }).elements()).toHaveLength(0);
  await expect.element(pane.getByRole("button", { name: "Full Screen" })).toBeVisible();
  expect(pane.getByRole("button", { name: "Move to…" }).elements()).toHaveLength(0);
});

test("every file shown wears the in-pane mark, and the strip centres the first", async () => {
  showThree();
  const screen = await render(<Harness grid />);
  for (const name of ["pyramid.jpg", "sphinx.jpg", "felucca.mp4"]) {
    await expect
      .element(screen.getByRole("main").getByRole("button", { name, exact: true }))
      .toHaveAttribute("aria-current", "true");
  }
  const strip = screen.getByRole("listbox", { name: "Filmstrip" });
  const first = strip.getByRole("option", { name: "pyramid.jpg" });
  await expect.element(first).toHaveAttribute("aria-selected", "true");
  const centre = (box: DOMRect) => box.left + box.width / 2;
  await expect
    .poll(() =>
      Math.abs(
        centre(first.element().getBoundingClientRect()) -
          centre(strip.element().getBoundingClientRect()),
      ),
    )
    .toBeLessThan(1);
});

test("a click on a file shows it alone, from the place it came from", async () => {
  showThree();
  await render(<Harness />);
  await file("sphinx.jpg").click();
  expect(getPaneSet()).toEqual([id("sphinx.jpg")]);
});

test("× takes a file out, the focus passing on, and the last but one leaves the picture focused", async () => {
  showThree();
  const screen = await render(<Harness />);
  await expect.element(file("pyramid.jpg")).toBeVisible();
  await tabIn();
  await expect.element(file("pyramid.jpg")).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(file("sphinx.jpg")).toHaveFocus();
  await userEvent.tab();
  const remove = files().getByRole("button", { name: "Remove from Pane" });
  await expect.element(remove.nth(1)).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(getPaneSet()).toEqual([id("pyramid.jpg"), id("felucca.mp4")]);
  // The next one, felucca, has the focus; taking out the last but one leaves pyramid alone.
  await expect
    .element(
      page.getByRole("group", { name: "2 Files" }).getByRole("button", { name: "felucca.mp4" }),
    )
    .toHaveFocus();
  await userEvent.tab();
  await userEvent.keyboard("{Enter}");
  expect(getPaneSet()).toEqual([id("pyramid.jpg")]);
  await expect
    .poll(() => document.activeElement?.closest('[aria-label="Pane"]') !== null)
    .toBe(true);
  await expect.element(screen.getByRole("heading", { name: "pyramid.jpg" })).toBeInTheDocument();
});

test("Enter shows the focused file alone, and the arrows go in reading order", async () => {
  showThree();
  await render(<Harness />);
  await expect.element(file("pyramid.jpg")).toBeVisible();
  await tabIn();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  await expect.element(file("felucca.mp4")).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}{Enter}");
  expect(getPaneSet()).toEqual([id("sphinx.jpg")]);
});

test("Escape in the pane shows the first alone, once a checked set has been cleared", async () => {
  showThree();
  await render(<Harness />);
  await expect.element(file("pyramid.jpg")).toBeVisible();
  toggleChecked(id("sphinx.jpg"));
  await tabIn();
  await userEvent.keyboard("{ArrowRight}");
  // The checked set closes first; the pane is left as it is.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  clearChecked();
  expect(getPaneSet()).toHaveLength(3);
  await userEvent.keyboard("{Escape}");
  expect(getPaneSet()).toEqual([id("pyramid.jpg")]);
  expect(getPaneItem()).toBe(id("pyramid.jpg"));
});

function LeavesFullScreen() {
  useEscapeLeavesFullScreen();
  return null;
}

test("after × on the first file in full screen, one Escape only leaves full screen", async () => {
  showThree();
  await render(
    <>
      <LeavesFullScreen />
      <Harness />
    </>,
  );
  setFullScreen(true);
  await expect.element(file("pyramid.jpg")).toBeVisible();
  await tabIn();
  await expect.element(file("pyramid.jpg")).toHaveFocus();
  await userEvent.tab();
  await userEvent.keyboard("{Enter}");
  expect(getPaneSet()).toEqual([id("sphinx.jpg"), id("felucca.mp4")]);
  await expect
    .poll(() => document.activeElement?.closest('[aria-label="Pane"]') !== null)
    .toBe(true);
  await userEvent.keyboard("{Escape}");
  expect(getFullScreen()).toBe(false);
  expect(getPaneSet()).toEqual([id("sphinx.jpg"), id("felucca.mp4")]);
  await userEvent.keyboard("{Escape}");
  expect(getPaneSet()).toEqual([id("sphinx.jpg")]);
});

test("Escape over the folded pane opened over the grid only puts the pane away", async () => {
  await page.viewport(640, 480);
  showThree();
  const screen = await render(
    <PaneDetailProvider>
      <div className="flex h-dvh flex-col">
        <Frame pane={<Pane />} paneHeader={<PaneHeader />} />
      </div>
    </PaneDetailProvider>,
  );
  await screen.getByRole("button", { name: "Show Pane" }).click();
  await expect.element(file("sphinx.jpg")).toBeVisible();
  (file("sphinx.jpg").element() as HTMLElement).focus();
  const pane = screen.getByRole("complementary", { name: "Pane" }).element() as HTMLElement;
  expect(pane.dataset.overGrid).toBe("true");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => pane.dataset.overGrid).toBeUndefined();
  expect(getPaneSet()).toHaveLength(3);
});

test("Escape with the focus outside the pane leaves the set as it is", async () => {
  showThree();
  const screen = await render(<Harness grid />);
  await expect.element(file("pyramid.jpg")).toBeVisible();
  (screen.getByRole("main").getByRole("button").first().element() as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  expect(getPaneSet()).toHaveLength(3);
});

test("a right-click on a file is its tile's menu, Remove from Pane at its head", async () => {
  showThree();
  await render(<Harness />);
  await file("sphinx.jpg").click({ button: "right" });
  const items = page.getByRole("menuitem").elements();
  expect(items[0]?.textContent).toContain("Remove from Pane");
  await page.getByRole("menuitem", { name: "Remove from Pane" }).click();
  expect(getPaneSet()).toEqual([id("pyramid.jpg"), id("felucca.mp4")]);
});

test("a file deleted leaves the set, and the rest stay", async () => {
  showThree();
  await render(<Harness />);
  await expect.element(file("sphinx.jpg")).toBeVisible();
  await deleteFiles([id("pyramid.jpg")]);
  await expect.poll(getPaneSet).toEqual([id("sphinx.jpg"), id("felucca.mp4")]);
});

test("videos loop muted, and unmuting one takes the sound from the one that had it", async () => {
  const sorting = await folderItems(2);
  const other = sorting.find((row) => row.diskName === "clip.mp4");
  if (!other) throw new Error("the mock has no clip.mp4");
  const url = await clip(320, 180, 600);
  undoServe = serveFiles({ "felucca.mp4": url, "clip.mp4": url });
  showInPane(id("felucca.mp4"), CAIRO);
  addToPane([other.id, id("pyramid.jpg")], { kind: "sorting" });
  await render(<Harness />);
  const group = page.getByRole("group", { name: "3 Files" });
  await expect.element(group).toBeVisible();
  const videos = () => [...group.element().querySelectorAll("video")];
  await expect.poll(() => videos().length).toBe(2);
  await expect.poll(() => videos().every((video) => !video.paused && video.loop)).toBe(true);
  expect(videos().every((video) => video.muted)).toBe(true);

  const unmute = group.getByRole("button", { name: "Unmute" });
  await expect.poll(() => unmute.elements().length).toBe(2);
  await unmute.first().click();
  await expect.poll(() => videos().map((video) => video.muted)).toEqual([false, true]);
  await group.getByRole("button", { name: "Unmute" }).click();
  await expect.poll(() => videos().map((video) => video.muted)).toEqual([true, false]);
  // The plate sits a tile-inset in from the clip's bottom-left.
  const plate = group.getByRole("button", { name: "Mute" }).element().getBoundingClientRect();
  const drawn = group.getByRole("button", { name: "clip.mp4" }).element().getBoundingClientRect();
  const inset = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.5;
  expect(plate.left - drawn.left).toBeCloseTo(inset, 0);
  expect(drawn.bottom - plate.bottom).toBeCloseTo(inset, 0);
});

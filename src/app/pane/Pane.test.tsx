import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeAll, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { folderItems, itemDetail } from "../../ipc/commands";
import { Grid } from "../grid/Grid";
import { type Place, setPlace } from "../place";
import { getPreferences, updatePreferences } from "../preferences";
import { Pane, PaneHeader } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { showInPane } from "./pane-store";

// These run against the dev mock's library, until the last two tests replace it.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

async function inCairo(name: string) {
  const item = (await folderItems(6)).find((row) => row.diskName === name);
  if (!item) throw new Error(`the mock has no ${name} in Cairo`);
  return item;
}

// Read before any test replaces the mock, for a test that copies a real item many times.
let sample: ItemRow;
let sampleDetail: ItemDetail;
beforeAll(async () => {
  sample = await inCairo("pyramid.jpg");
  sampleDetail = (await itemDetail(sample.id)) as ItemDetail;
});

/** The grid and the pane side by side, joined by the click as the app joins them. */
function Harness({ grid = true }: { grid?: boolean }) {
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex", width: 1100, height: 700 }}>
        {grid && (
          <div style={{ width: 700, height: 700 }}>
            <Grid mode="justified" />
          </div>
        )}
        <aside aria-label="Pane" style={{ display: "flex", flexDirection: "column", width: 400 }}>
          <PaneHeader />
          <div style={{ flex: 1, minHeight: 0 }}>
            <Pane />
          </div>
        </aside>
      </div>
    </PaneDetailProvider>
  );
}

beforeEach(async () => {
  showInPane(null);
  setPlace(CAIRO);
  updatePreferences({ details: undefined });
  await page.viewport(1200, 800);
});

test("the pane shows the picture clicked, and the next click replaces it", async () => {
  const screen = await render(<Harness />);
  const pane = screen.getByRole("complementary", { name: "Pane" });
  await expect.element(pane.getByText("Click a picture to see it here.")).toBeVisible();

  const pyramid = screen.getByRole("button", { name: "pyramid.jpg" });
  await pyramid.click();
  await expect.element(pane.getByRole("heading", { name: "pyramid.jpg" })).toBeInTheDocument();
  await expect.element(pyramid).toHaveAttribute("aria-current", "true");

  await screen.getByRole("button", { name: "sphinx.jpg" }).click();
  await expect.element(pane.getByRole("heading", { name: "sphinx.jpg" })).toBeInTheDocument();
  await expect.element(pyramid).not.toHaveAttribute("aria-current");
});

test("the header row gives the shape and size, and opens onto the rest, remembered", async () => {
  const pyramid = await inCairo("pyramid.jpg");
  showInPane(pyramid.id);
  const screen = await render(<Harness />);
  const pane = screen.getByRole("complementary", { name: "Pane" });
  const shape = `${pyramid.width} × ${pyramid.height}`;

  const row = pane.getByRole("button", { name: new RegExp(`^${shape} · 2[.,]3 MB$`) });
  await expect.element(row).toHaveAttribute("aria-expanded", "false");
  expect(pane.getByRole("region", { name: "Details" }).elements()).toHaveLength(0);

  await row.click();
  const details = pane.getByRole("region", { name: "Details" });
  for (const term of ["Where", "File", "Dates", "Name"]) {
    await expect.element(details.getByText(term, { exact: true })).toBeVisible();
  }
  await expect.element(details.getByText(shape)).toBeVisible();
  await expect.element(details.getByText(/^2[.,]3 MB$/)).toBeVisible();
  await expect.element(details.getByText("pyramid.jpg", { exact: true })).toBeVisible();
  expect(getPreferences().details).toBe(true);
});

test("the folders the picture sits in each lead there", async () => {
  const pyramid = await inCairo("pyramid.jpg");
  showInPane(pyramid.id);
  updatePreferences({ details: true });
  setPlace({ kind: "sorting" });
  const screen = await render(<Harness />);
  const pane = screen.getByRole("complementary", { name: "Pane" });

  await pane.getByRole("button", { name: "Trips" }).click();
  await expect.element(screen.getByRole("button", { name: "hotel.jpg" })).toBeVisible();
});

test("a video plays in the pane over its poster, and the header says how long it runs", async () => {
  const felucca = await inCairo("felucca.mp4");
  showInPane(felucca.id);
  const screen = await render(<Harness />);
  const pane = screen.getByRole("complementary", { name: "Pane" });

  await expect.element(pane.getByRole("button", { name: /0:12/ })).toBeVisible();
  const video = document.querySelector("aside video") as HTMLVideoElement;
  expect(video.controls).toBe(true);
  expect(video.poster).toMatch(/^data:image\/svg/);
});

test("an item that has gone says so", async () => {
  showInPane(9999);
  const screen = await render(<Harness />);
  await expect.element(screen.getByText("This file is no longer here.")).toBeVisible();
});

test("the filmstrip runs through the place the picture was clicked in, wherever the grid goes", async () => {
  const cairo = await folderItems(6);
  const screen = await render(<Harness />);
  const pane = screen.getByRole("complementary", { name: "Pane" });
  await screen.getByRole("button", { name: "pyramid.jpg" }).click();

  const strip = pane.getByRole("listbox", { name: "Filmstrip" });
  const pyramid = strip.getByRole("option", { name: "pyramid.jpg" });
  await expect.element(pyramid).toHaveAttribute("aria-selected", "true");
  await expect.element(pyramid).toHaveAttribute("aria-setsize", String(cairo.length));

  await strip.getByRole("option", { name: "sphinx.jpg" }).click();
  await expect.element(pane.getByRole("heading", { name: "sphinx.jpg" })).toBeInTheDocument();

  setPlace({ kind: "sorting" });
  await expect.element(screen.getByRole("button", { name: "DSC_0001.jpg" })).toBeVisible();
  await expect
    .element(strip.getByRole("option", { name: "sphinx.jpg" }))
    .toHaveAttribute("aria-selected", "true");
});

test("the step buttons and the arrow keys move along the strip", async () => {
  const [first, second] = (await folderItems(6)) as [ItemRow, ItemRow];
  showInPane(first.id, CAIRO);
  const screen = await render(<Harness grid={false} />);
  const pane = screen.getByRole("complementary", { name: "Pane" });

  await expect.element(pane.getByRole("button", { name: "Previous" })).toBeDisabled();
  await pane.getByRole("button", { name: "Next" }).click();
  await expect.element(pane.getByRole("heading", { name: second.diskName })).toBeInTheDocument();

  await pane.getByRole("option", { name: second.diskName }).click();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(pane.getByRole("heading", { name: first.diskName })).toBeInTheDocument();
  await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe(first.diskName);
});

test("the pane reads the item again when background work moves on", async () => {
  const pyramid = await inCairo("pyramid.jpg");
  const answer = await itemDetail(pyramid.id);
  let asked = 0;
  mockIPC(
    (cmd) => {
      if (cmd === "item_detail") {
        asked += 1;
        return answer;
      }
      return cmd === "item_tags" ? [] : undefined;
    },
    { shouldMockEvents: true },
  );
  showInPane(pyramid.id);
  await render(
    <PaneDetailProvider>
      <Pane />
    </PaneDetailProvider>,
  );
  await expect.poll(() => asked).toBe(1);

  await emit("job-progress", { phase: "working", pending: 1, running: 1, failed: 0, completed: 3 });
  await expect.poll(() => asked).toBe(2);
});

test("steps taken faster than the pane reads each item still land one after another", async () => {
  const rows: ItemRow[] = [1, 2, 3].map((id) => ({ ...sample, id, diskName: `step-${id}.jpg` }));
  mockIPC(
    async (cmd, payload) => {
      if (cmd === "folder_items") return rows;
      if (cmd === "item_detail") {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const id = (payload as { itemId: number }).itemId;
        return { ...sampleDetail, id, diskName: `step-${id}.jpg` };
      }
      return cmd === "item_tags" ? [] : undefined;
    },
    { shouldMockEvents: true },
  );
  showInPane(1, CAIRO);
  const screen = await render(<Harness grid={false} />);
  const strip = screen.getByRole("listbox", { name: "Filmstrip" });

  await strip.getByRole("option", { name: "step-1.jpg" }).click();
  await userEvent.keyboard("{ArrowRight}{ArrowRight}");
  await expect
    .element(strip.getByRole("option", { name: "step-3.jpg" }))
    .toHaveAttribute("aria-selected", "true");
});

test("a long place draws only the frames near the one shown, with that one centred", async () => {
  const rows: ItemRow[] = Array.from({ length: 5000 }, (_, at) => ({
    ...sample,
    id: at + 1,
    diskName: `frame-${at + 1}.jpg`,
  }));
  mockIPC(
    (cmd, payload) => {
      if (cmd === "folder_items") return rows;
      if (cmd === "item_detail") {
        const id = (payload as { itemId: number }).itemId;
        return { ...sampleDetail, id, diskName: `frame-${id}.jpg` };
      }
      return cmd === "item_tags" ? [] : undefined;
    },
    { shouldMockEvents: true },
  );
  showInPane(2500, CAIRO);
  const screen = await render(<Harness grid={false} />);
  const strip = screen.getByRole("listbox", { name: "Filmstrip" });
  const shown = strip.getByRole("option", { name: "frame-2500.jpg" });

  await expect.element(shown).toHaveAttribute("aria-posinset", "2500");
  expect(strip.getByRole("option").elements().length).toBeLessThan(50);
  const centre = (box: DOMRect) => box.left + box.width / 2;
  await expect
    .poll(() =>
      Math.abs(
        centre(shown.element().getBoundingClientRect()) -
          centre(strip.element().getBoundingClientRect()),
      ),
    )
    .toBeLessThan(1);
});

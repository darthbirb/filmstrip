import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { folderItems, itemDetail } from "../../ipc/commands";
import { Grid } from "../grid/Grid";
import { type Place, setPlace } from "../place";
import { PANE_CANDIDATES, Pane, type PaneCandidate } from "./Pane";
import { showInPane } from "./pane-store";

// These run against the dev mock's library, until the last test replaces it.

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

/** The grid and the pane side by side, joined by the click as the app joins them. */
function Harness({ candidate }: { candidate: PaneCandidate }) {
  return (
    <div style={{ display: "flex", width: 1100, height: 700 }}>
      <div style={{ width: 700, height: 700 }}>
        <Grid mode="justified" />
      </div>
      <aside aria-label="Pane" style={{ display: "flex", flexDirection: "column", width: 400 }}>
        <Pane candidate={candidate} />
      </aside>
    </div>
  );
}

beforeEach(async () => {
  showInPane(null);
  setPlace(CAIRO);
  await page.viewport(1200, 800);
});

test("the pane shows the picture clicked, and the next click replaces it", async () => {
  const screen = await render(<Harness candidate="stack" />);
  const pane = screen.getByRole("complementary", { name: "Pane" });
  await expect.element(pane.getByText("Click a picture to see it here.")).toBeVisible();

  const pyramid = screen.getByRole("button", { name: "pyramid.jpg" });
  await pyramid.click();
  await expect.element(pane.getByRole("heading", { name: "pyramid.jpg" })).toBeVisible();
  await expect.element(pyramid).toHaveAttribute("aria-current", "true");

  await screen.getByRole("button", { name: "sphinx.jpg" }).click();
  await expect.element(pane.getByRole("heading", { name: "sphinx.jpg" })).toBeVisible();
  await expect.element(pyramid).not.toHaveAttribute("aria-current");
});

test.each(PANE_CANDIDATES)(
  "the %s candidate tells everything known about a picture",
  async (candidate) => {
    const pyramid = await inCairo("pyramid.jpg");
    showInPane(pyramid.id);
    const screen = await render(<Harness candidate={candidate} />);
    const pane = screen.getByRole("complementary", { name: "Pane" });
    await expect.element(pane.getByRole("heading", { name: "pyramid.jpg" })).toBeVisible();
    if (candidate === "viewer") await pane.getByRole("button", { name: "Details" }).click();

    for (const term of ["Where", "Taken", "Modified", "Dimensions", "File"]) {
      await expect.element(pane.getByText(term, { exact: true })).toBeVisible();
    }
    await expect.element(pane.getByText(`${pyramid.width} × ${pyramid.height}`)).toBeVisible();
    await expect.element(pane.getByText(/^JPG · 2[.,]3 MB$/)).toBeVisible();
  },
);

test("the folders the picture sits in each lead there", async () => {
  const pyramid = await inCairo("pyramid.jpg");
  showInPane(pyramid.id);
  setPlace({ kind: "sorting" });
  const screen = await render(<Harness candidate="stack" />);
  const pane = screen.getByRole("complementary", { name: "Pane" });

  await pane.getByRole("button", { name: "Trips" }).click();
  await expect.element(screen.getByRole("button", { name: "hotel.jpg" })).toBeVisible();
});

test("a video plays in the pane over its poster, and says how long it runs", async () => {
  const felucca = await inCairo("felucca.mp4");
  showInPane(felucca.id);
  const screen = await render(<Harness candidate="stack" />);
  const pane = screen.getByRole("complementary", { name: "Pane" });

  await expect.element(pane.getByText("0:12")).toBeVisible();
  const video = document.querySelector("aside video") as HTMLVideoElement;
  expect(video.controls).toBe(true);
  expect(video.poster).toMatch(/^data:image\/svg/);
});

test("an item that has gone says so", async () => {
  showInPane(9999);
  const screen = await render(<Harness candidate="stack" />);
  await expect.element(screen.getByText("This file is no longer here.")).toBeVisible();
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
  await render(<Pane candidate="stack" />);
  await expect.poll(() => asked).toBe(1);

  await emit("job-progress", { phase: "working", pending: 1, running: 1, failed: 0, completed: 3 });
  await expect.poll(() => asked).toBe(2);
});

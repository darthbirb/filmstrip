import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { deleteFolder, setFolderStatus, undoLast } from "../../ipc/commands";
import { FolderBand } from "../grid/FolderBand";
import { resetFolderDetail, setBandOpen } from "../grid/folder-detail";
import { Grid } from "../grid/Grid";
import { libraryChanged } from "../library";
import { Breadcrumb } from "../navigation/Breadcrumb";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { setOpenFolders } from "../navigation/open-folders";
import { getPlace, type Place, setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { Pane, PaneHeader } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { getPaneFolder, getPaneItem, getPaneOrigin, showInPane } from "./pane-store";

// Against the dev mock: Pictures holds cover.jpg, People (empty) and Trips, which holds
// boarding-pass.png and hotel.jpg, and Cairo, which holds three. Archive is offline.

const PICTURES: Place = { kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] };
const TRIPS: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
  ],
};

function Harness({ pane = 400 }: { pane?: number }) {
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex", width: 1300, height: 760 }}>
        <nav style={{ width: 260 }}>
          <Navigation />
        </nav>
        <div style={{ width: 600, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", height: 44, alignItems: "center" }}>
            <Breadcrumb />
          </div>
          <FolderBand />
          <div style={{ flex: 1, minHeight: 0 }}>
            <Grid mode="justified" />
          </div>
        </div>
        <aside aria-label="Pane" style={{ display: "flex", flexDirection: "column", width: pane }}>
          <div style={{ height: 44 }}>
            <PaneHeader />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Pane />
          </div>
        </aside>
      </div>
    </PaneDetailProvider>
  );
}

type Screen = Awaited<ReturnType<typeof render>>;

const pane = (screen: Screen) => screen.getByRole("complementary", { name: "Pane" });

async function showInPaneFrom(screen: Screen, row: string, name: string) {
  await screen.getByRole("treeitem", { name: row }).click({ button: "right" });
  const menu = screen.getByRole("menu", { name });
  await expect.element(menu).toBeVisible();
  const rows = menu.getByRole("menuitem").elements();
  expect(rows[0]?.textContent).toContain("Show in Pane");
  await menu.getByRole("menuitem", { name: "Show in Pane" }).click();
}

async function openTrips(screen: Screen) {
  await screen.getByRole("treeitem", { name: "Pictures 1 of 6" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await showInPaneFrom(screen, "Trips 2 of 5", "Trips");
}

beforeEach(async () => {
  while (await undoLast()) {}
  showInPane(null);
  resetFolderDetail();
  updatePreferences({ details: false });
  setPlace(PICTURES);
  resetIndex();
  await loadIndex();
  await page.viewport(1400, 800);
});

test("Show in Pane puts the folder where a file stands: its name, its count, its cover, its own files", async () => {
  const screen = await render(<Harness />);
  await openTrips(screen);
  const shown = pane(screen);
  await expect.element(shown.getByRole("button", { name: "Trips 2 of 5" })).toBeVisible();
  await expect.element(shown.getByRole("img", { name: "Cover of Trips" })).toBeVisible();
  await expect.element(shown.getByRole("button", { name: /^Choose Cover/ })).toBeVisible();
  // The grid and navigation stay where they were.
  expect(getPlace()).toEqual(PICTURES);
  expect(getPaneItem()).toBeNull();

  const strip = shown.getByRole("listbox", { name: "Filmstrip" });
  await expect.element(strip).toBeVisible();
  const frames = strip.getByRole("option").elements();
  expect(frames.map((frame) => frame.getAttribute("aria-label"))).toEqual([
    "boarding-pass.png",
    "hotel.jpg",
  ]);
  expect(frames.every((frame) => frame.getAttribute("aria-selected") === "false")).toBe(true);
  await expect.element(shown.getByRole("button", { name: "Previous" })).toBeDisabled();

  // The forward step shows the first file, the folder becoming the place it was clicked in.
  await shown.getByRole("button", { name: "Next" }).click();
  await expect
    .element(shown.getByRole("heading", { name: "boarding-pass.png" }))
    .toBeInTheDocument();
  expect(getPaneFolder()).toBeNull();
  expect(getPaneOrigin()).toEqual(TRIPS);
});

test("Open goes into the folder, its row selected, and the pane keeps showing it", async () => {
  const screen = await render(<Harness />);
  await openTrips(screen);
  await pane(screen).getByRole("button", { name: "Open Trips" }).click();
  expect(getPlace()).toEqual(TRIPS);
  await expect
    .element(screen.getByRole("treeitem", { name: "Trips 2 of 5" }))
    .toHaveAttribute("aria-selected", "true");
  expect(getPaneFolder()?.folderId).toBe(4);
});

test("its details are the band's rows, and a change in one shows in the other", async () => {
  await setFolderStatus(4, null);
  setBandOpen(true);
  setPlace(TRIPS);
  setOpenFolders(new Set([1]));
  const screen = await render(<Harness />);
  await showInPaneFrom(screen, "Trips 2 of 5", "Trips");
  const shown = pane(screen);
  await shown.getByRole("button", { name: "Trips 2 of 5" }).click();
  const details = shown.getByRole("region", { name: "Details" });
  await expect.element(details).toBeVisible();
  const terms = [...details.element().querySelectorAll("dt")].map((dt) => dt.textContent);
  expect(terms).toEqual(["Path", "Status", "Labels", "Tags", "Note"]);

  await details.getByText("Working", { exact: true }).click();
  // The band's own group and the pane's, both checked by the one click.
  const working = screen.getByRole("radio", { name: "Working" });
  await expect
    .poll(() => working.elements().map((radio) => (radio as HTMLInputElement).checked))
    .toEqual([true, true]);
  await setFolderStatus(4, null);
});

test("the ⋯ holds the folder's menu without Show in Pane, and Show in Explorer folds into it", async () => {
  const screen = await render(<Harness pane={170} />);
  await openTrips(screen);
  const bar = pane(screen).getByRole("toolbar", { name: "Actions" });
  await expect.element(bar.getByRole("button", { name: "Open Trips" })).toBeVisible();
  expect(bar.getByRole("button", { name: "Show in Explorer" }).query()).toBeNull();
  await bar.getByRole("button", { name: "More" }).click();
  const more = screen.getByRole("menu", { name: "More" });
  const rows = more
    .getByRole("menuitem")
    .elements()
    .map((row) => row.textContent);
  expect(rows[0]).toContain("Show in Explorer");
  expect(rows.some((row) => row?.includes("Show in Pane"))).toBe(false);
  expect(rows.some((row) => row?.includes("Delete"))).toBe(true);
});

test("with room, Show in Explorer stands on the bar and leaves the ⋯", async () => {
  const screen = await render(<Harness />);
  await openTrips(screen);
  const bar = pane(screen).getByRole("toolbar", { name: "Actions" });
  await expect.element(bar.getByRole("button", { name: "Show in Explorer" })).toBeVisible();
  await bar.getByRole("button", { name: "More" }).click();
  const rows = screen
    .getByRole("menu", { name: "More" })
    .getByRole("menuitem")
    .elements()
    .map((row) => row.textContent);
  expect(rows.some((row) => row?.includes("Show in Explorer"))).toBe(false);
});

test("an offline source is shown from the index: its pill says offline, and nothing needs the drive", async () => {
  const screen = await render(<Harness />);
  await showInPaneFrom(screen, "Archive offline", "Archive");
  const shown = pane(screen);
  await expect.element(shown.getByText("Archive Is Offline")).toBeVisible();
  await expect.element(shown.getByRole("button", { name: "Archive offline" })).toBeVisible();
  const bar = shown.getByRole("toolbar", { name: "Actions" });
  expect(bar.getByRole("button", { name: "Show in Explorer" }).query()).toBeNull();
  expect(shown.getByRole("listbox", { name: "Filmstrip" }).query()).toBeNull();
});

test("an empty folder says so, with no cover and no strip", async () => {
  const screen = await render(<Harness />);
  await screen.getByRole("treeitem", { name: "Pictures 1 of 6" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await showInPaneFrom(screen, "People 0 of 0", "People");
  const shown = pane(screen);
  await expect.element(shown.getByText("This Folder Is Empty")).toBeVisible();
  expect(shown.getByRole("button", { name: /^Choose Cover/ }).query()).toBeNull();
  expect(shown.getByRole("listbox", { name: "Filmstrip" }).query()).toBeNull();
});

test("deleted in the app the pane shows nothing; gone otherwise, it says so over its path", async () => {
  const screen = await render(<Harness />);
  await screen.getByRole("treeitem", { name: "Pictures 1 of 6" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await showInPaneFrom(screen, "People 0 of 0", "People");
  await pane(screen).getByRole("button", { name: "More" }).click();
  await screen
    .getByRole("menu", { name: "More" })
    .getByRole("menuitem", { name: "Delete" })
    .click();
  await expect.element(pane(screen).getByText("Nothing Chosen Yet")).toBeVisible();
  expect(getPaneFolder()).toBeNull();
  while (await undoLast()) {}
  await libraryChanged();

  await showInPaneFrom(screen, "People 0 of 0", "People");
  await expect.element(pane(screen).getByText("This Folder Is Empty")).toBeVisible();
  // Gone by anything but the pane's own verbs, as a walk retires a folder deleted in Explorer.
  await deleteFolder(5, null);
  await libraryChanged();
  await expect.element(pane(screen).getByText("This Folder Has Gone")).toBeVisible();
  await expect.element(pane(screen).getByText("D:\\Pictures\\People")).toBeVisible();
  expect(pane(screen).getByRole("toolbar", { name: "Actions" }).query()).toBeNull();
});

test("a search's folder card opens its folder's menu, Show in Pane at its head", async () => {
  setPlace({ kind: "search", query: "path:Pictures/Trips cairo", back: TRIPS });
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: /^Cairo/ }).click({ button: "right" });
  const menu = screen.getByRole("menu", { name: "Cairo" });
  await expect.element(menu).toBeVisible();
  expect(menu.getByRole("menuitem").elements()[0]?.textContent).toContain("Show in Pane");
  await menu.getByRole("menuitem", { name: "Show in Pane" }).click();
  expect(getPaneFolder()?.folderId).toBe(6);
  await expect.element(pane(screen).getByRole("button", { name: "Open Cairo" })).toBeVisible();
});

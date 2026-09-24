import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { folderChildren, undoLast } from "../../ipc/commands";
import { type Place, setPlace } from "../place";
import { ReportBanner } from "../undo/ReportBanner";
import { showReport } from "../undo/report-store";
import { Foot } from "./Foot";
import { setNews } from "./foot-slot";
import { loadIndex, resetIndex } from "./index-store";
import { Navigation } from "./Navigation";

// Against the dev mock: Pictures holds People, empty, and Trips, which holds Cairo's three files
// and two of its own; Incoming is the sorting source.

const PICTURES: Place = { kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] };

function Harness() {
  return (
    <div style={{ display: "flex", width: 1000, height: 700 }}>
      <nav style={{ display: "flex", flexDirection: "column", width: 280 }}>
        <div style={{ flex: 1 }}>
          <Navigation />
        </div>
        <Foot />
      </nav>
      <main style={{ flex: 1 }}>
        <ReportBanner />
      </main>
    </div>
  );
}

type Screen = Awaited<ReturnType<typeof render>>;

async function choose(screen: Screen, row: string, name: string, verb: string) {
  await screen.getByRole("treeitem", { name: row }).click({ button: "right" });
  const menu = screen.getByRole("menu", { name });
  await expect.element(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: verb }).click();
}

/** Opens Pictures in the tree, so its folders' rows are there to right-click. */
async function openPictures(screen: Screen) {
  await screen.getByRole("treeitem", { name: "Pictures" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(screen.getByRole("treeitem", { name: "Trips 2" })).toBeVisible();
}

const titles = async (folderId: number) =>
  (await folderChildren(folderId)).map((folder) => folder.title);

beforeEach(async () => {
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  setPlace(PICTURES);
  resetIndex();
  await loadIndex();
  await page.viewport(1100, 760);
});

test("New Folder lands a row in its place, already in its field, and Enter makes it", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await choose(screen, "Trips 2", "Trips", "New Folder");

  const field = screen.getByRole("textbox", { name: "Folder Name" });
  await expect.element(field).toHaveFocus();
  const input = field.element() as HTMLInputElement;
  expect([input.value, input.selectionStart, input.selectionEnd]).toEqual(["New folder", 0, 10]);
  // In its place in the order: after Cairo, one level in.
  const rows = screen.getByRole("treeitem").elements();
  const at = rows.findIndex((row) => row.contains(input));
  expect(rows[at - 1]?.getAttribute("aria-label")).toBe("Cairo 3");
  expect(rows[at]?.getAttribute("aria-level")).toBe("3");

  await userEvent.keyboard("Egypt{Enter}");
  await expect.element(screen.getByRole("treeitem", { name: "Egypt" })).toBeVisible();
  await expect.element(screen.getByText("Created Egypt in Trips.")).toBeVisible();
  expect(await titles(4)).toEqual(["Cairo", "Egypt"]);
});

test("Escape leaves nothing, and a name already there is said under the row", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await choose(screen, "Trips 2", "Trips", "New Folder");
  const field = screen.getByRole("textbox", { name: "Folder Name" });
  await userEvent.keyboard("{Escape}");
  await expect.element(field).not.toBeInTheDocument();
  await expect.element(screen.getByRole("treeitem", { name: "Trips 2" })).toHaveFocus();
  expect(await titles(4)).toEqual(["Cairo"]);

  await choose(screen, "Trips 2", "Trips", "New Folder");
  await userEvent.keyboard("cairo{Enter}");
  await expect.element(screen.getByText("Trips already has a folder named cairo.")).toBeVisible();
  expect(await titles(4)).toEqual(["Cairo"]);
});

test("New Folder opens a shut folder, and on a source's row makes one at its top level", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await choose(screen, "People", "People", "New Folder");
  await expect
    .element(screen.getByRole("treeitem", { name: "People" }))
    .toHaveAttribute("aria-expanded", "true");
  await userEvent.keyboard("Family{Enter}");
  await expect.element(screen.getByRole("treeitem", { name: "Family" })).toBeVisible();

  await choose(screen, "Pictures", "Pictures", "New Folder");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByText("Created New folder in Pictures.")).toBeVisible();
  expect(await titles(1)).toEqual(["New folder", "People", "Trips"]);
});

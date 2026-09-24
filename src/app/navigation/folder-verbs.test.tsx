import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import {
  createFolder,
  folderChildren,
  folderItems,
  listSources,
  renameItem,
  undoLast,
} from "../../ipc/commands";
import { MovePickerHost } from "../pane/move-picker";
import { getPlace, type Place, setPlace } from "../place";
import { getPreferences, updatePreferences } from "../preferences";
import { ReportBanner } from "../undo/ReportBanner";
import { showReport } from "../undo/report-store";
import { DeleteQuestion, resetDeleteQuestion } from "./delete-folder";
import { Foot } from "./Foot";
import { setNews } from "./foot-slot";
import { loadIndex, resetIndex } from "./index-store";
import { Navigation } from "./Navigation";
import { openFolders } from "./open-folders";

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
        <DeleteQuestion />
        <ReportBanner />
      </main>
      <MovePickerHost />
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
  resetDeleteQuestion();
  updatePreferences({ deleteInto: undefined });
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

const where = () => {
  const place = getPlace();
  return place?.kind === "folder" ? place.path.map((crumb) => crumb.title).join("/") : null;
};

test("Move to… on a folder cannot pick its own branch, and moves it with what it holds", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await choose(screen, "Trips 2", "Trips", "Move to…");
  const picker = screen.getByRole("dialog", { name: "Move to" });
  await expect.element(picker).toBeVisible();
  const option = (name: string) => picker.getByRole("option", { name, exact: true });
  await expect.element(option("Pictures current")).toHaveAttribute("aria-disabled", "true");
  await expect.element(option("Trips")).toHaveAttribute("aria-disabled", "true");
  await picker.getByRole("combobox").fill("cai");
  await expect.element(option("Cairo Trips")).toHaveAttribute("aria-disabled", "true");

  await picker.getByRole("combobox").fill("peo");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByText("Moved Trips to People.")).toBeVisible();
  expect(await titles(5)).toEqual(["Trips"]);
});

test("a folder moved while you stand in it takes you with it, the tree opened down to it", async () => {
  setPlace({
    kind: "folder",
    sourceId: 1,
    path: [
      { id: 1, title: "Pictures" },
      { id: 4, title: "Trips" },
      { id: 6, title: "Cairo" },
    ],
  });
  openFolders([1, 4]);
  const screen = await render(<Harness />);
  await choose(screen, "Trips 2", "Trips", "Move to…");
  await screen.getByRole("dialog", { name: "Move to" }).getByRole("combobox").fill("peo");
  await userEvent.keyboard("{Enter}");

  await expect.poll(where).toBe("Pictures/People/Trips/Cairo");
  const cairo = screen.getByRole("treeitem", { name: "Cairo 3" });
  await expect.element(cairo).toHaveAttribute("aria-selected", "true");
});

test("a folder whose name is taken where it was going stays, and says so in the banner", async () => {
  await createFolder(1, "Cairo");
  resetIndex();
  await loadIndex();
  openFolders([1, 4]);
  const screen = await render(<Harness />);
  await choose(screen, "Cairo 3", "Cairo", "Move to…");
  await screen.getByRole("dialog", { name: "Move to" }).getByRole("combobox").fill("pict");
  await userEvent.keyboard("{Enter}");

  await expect.element(screen.getByText("Cairo could not go to Pictures")).toBeVisible();
  await expect.element(screen.getByText("Not Moved")).toBeVisible();
  await expect.element(screen.getByText("Name taken in Pictures")).toBeVisible();
  expect(await titles(4)).toEqual(["Cairo"]);
});

test("an empty folder goes without asking, and Undo brings it back", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await choose(screen, "People", "People", "Delete");
  await expect.element(screen.getByText("Deleted People.")).toBeVisible();
  expect(await titles(1)).toEqual(["Trips"]);

  await screen.getByRole("button", { name: "Undo" }).click();
  await expect.element(screen.getByText("People is back in Pictures.")).toBeVisible();
  expect(await titles(1)).toEqual(["People", "Trips"]);
});

test("a folder with files asks where they go, and × answers none", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await choose(screen, "Trips 2", "Trips", "Delete");
  const question = screen.getByRole("region", { name: "Trips holds 5 files" });
  await expect.element(question).toHaveFocus();
  await expect
    .element(question.getByRole("button", { name: "Move Files to Incoming" }))
    .toBeVisible();
  await expect.element(question.getByRole("button", { name: "Delete Files Too" })).toBeVisible();
  await expect
    .element(question.getByRole("checkbox", { name: "Always Move to the One I Choose" }))
    .not.toBeChecked();

  await question.getByRole("button", { name: "Cancel" }).click();
  await expect.element(question).not.toBeInTheDocument();
  await expect.element(screen.getByRole("treeitem", { name: "Trips 2" })).toHaveFocus();
  expect(await titles(1)).toEqual(["People", "Trips"]);
});

test("moving its files to the sorting source deletes it, and the box keeps that answer", async () => {
  const screen = await render(<Harness />);
  await openPictures(screen);
  await choose(screen, "Trips 2", "Trips", "Delete");
  await screen.getByRole("checkbox", { name: "Always Move to the One I Choose" }).click();
  await screen.getByRole("button", { name: "Move Files to Incoming" }).click();

  await expect
    .element(screen.getByText("Deleted Trips. Its 5 files are in Incoming."))
    .toBeVisible();
  expect(await titles(1)).toEqual(["People"]);
  expect(await titles(2)).toEqual(["Cairo"]);
  expect(getPreferences().deleteInto).toBe(2);

  await screen.getByRole("button", { name: "Undo" }).click();
  await expect
    .element(screen.getByText("Trips and its 5 files are back in Pictures."))
    .toBeVisible();

  // Kept as the default, the next delete moves there without asking.
  await choose(screen, "Trips 2", "Trips", "Delete");
  await expect
    .element(screen.getByText("Deleted Trips. Its 5 files are in Incoming."))
    .toBeVisible();
  expect(screen.getByRole("region", { name: "Trips holds 5 files" }).elements()).toHaveLength(0);
});

test("with no sorting source the Trash is the only answer, and there is no box", async () => {
  const libraries = (await listSources()).filter((source) => source.kind === "library");
  await recording(
    async () => {
      resetIndex();
      await loadIndex();
      const screen = await render(<Harness />);
      await openPictures(screen);
      await choose(screen, "Trips 2", "Trips", "Delete");
      const question = screen.getByRole("region", { name: "Trips holds 5 files" });
      await expect.element(question).toBeVisible();
      expect(question.getByRole("checkbox").elements()).toHaveLength(0);
      expect(question.getByRole("button", { name: /Move Files/ }).elements()).toHaveLength(0);
      await question.getByRole("button", { name: "Delete Files Too" }).click();
      await expect.element(screen.getByText("Deleted Trips and its 5 files.")).toBeVisible();
    },
    (cmd) => (cmd === "list_sources" ? libraries : undefined),
  );
});

test("a folder deleted while you stand in it leaves you in its parent", async () => {
  setPlace({
    kind: "folder",
    sourceId: 1,
    path: [
      { id: 1, title: "Pictures" },
      { id: 4, title: "Trips" },
      { id: 6, title: "Cairo" },
    ],
  });
  openFolders([1, 4]);
  const screen = await render(<Harness />);
  await choose(screen, "Cairo 3", "Cairo", "Delete");
  await screen.getByRole("button", { name: "Delete Files Too" }).click();
  await expect.poll(where).toBe("Pictures/Trips");
  await expect
    .element(screen.getByRole("treeitem", { name: "Trips 2" }))
    .toHaveAttribute("aria-selected", "true");
});

test("a folder whose files could not all go stays, and the banner says where the rest are", async () => {
  const [first] = await folderItems(2);
  if (!first) throw new Error("the mock's sorting source is empty");
  await renameItem(first.id, "hotel.jpg");
  const screen = await render(<Harness />);
  await openPictures(screen);
  await choose(screen, "Trips 2", "Trips", "Delete");
  await screen.getByRole("button", { name: "Move Files to Incoming" }).click();

  await expect
    .element(screen.getByText("4 of Trips’ 5 files are in Incoming · Trips stayed"))
    .toBeVisible();
  await expect
    .element(screen.getByText("Moved 4 of Trips’ 5 files to Incoming. Trips is in the banner."))
    .toBeVisible();
  await expect.element(screen.getByText("Still in Trips")).toBeVisible();
  await expect.element(screen.getByText("Name taken in Incoming")).toBeVisible();
  expect(await titles(1)).toEqual(["People", "Trips"]);

  await screen.getByRole("button", { name: "Undo" }).click();
  await expect.element(screen.getByText("4 files are back in Trips.")).toBeVisible();
});

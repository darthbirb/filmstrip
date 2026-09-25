import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { folderItems, renameItem, trashItems, undoLast } from "../../ipc/commands";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { getPlace, type Place, setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { ReportBanner } from "../undo/ReportBanner";
import { showReport } from "../undo/report-store";
import { MovePickerHost } from "./move-picker";
import { Pane } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { getPaneItem, showInPane } from "./pane-store";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg; People is empty.

const TRASH: Place = { kind: "trash" };

beforeEach(async () => {
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  setPlace(TRASH);
  resetIndex();
  await loadIndex();
});

/** Sends a file in Cairo to the trash, and shows it in the pane as a click in the Trash would. */
async function trashed(name: string) {
  const row = (await folderItems(6)).find((item) => item.diskName === name);
  if (!row) throw new Error(`the mock has no ${name} in Cairo`);
  await trashItems([row.id]);
  showInPane(row.id, TRASH);
  return row.id;
}

function Harness() {
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex", width: 900, height: 700 }}>
        <main style={{ flex: 1 }}>
          <ReportBanner />
        </main>
        <aside
          aria-label="Pane"
          style={{ display: "flex", flexDirection: "column", width: 400, height: 700 }}
        >
          <Pane />
        </aside>
      </div>
      <Foot />
      <MovePickerHost />
    </PaneDetailProvider>
  );
}

const inCairo = async () => (await folderItems(6)).map((row) => row.diskName);

test("a file in the Trash says where it came from and when it went, and its bar holds only the way back", async () => {
  await trashed("pyramid.jpg");
  const screen = await render(<Harness />);
  const bar = screen.getByRole("toolbar", { name: "Actions" });
  await expect.element(bar.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  const words = bar
    .getByRole("button")
    .elements()
    .map((button) => button.querySelector(".truncate")?.textContent);
  expect(words).toEqual(["Restore", "Restore to…"]);

  updatePreferences({ details: true });
  await expect.element(screen.getByText("From")).toBeVisible();
  await expect.element(screen.getByText(/^Today, /)).toBeVisible();
  expect(screen.getByText("Where").elements()).toHaveLength(0);
});

test("Restore puts the file back where it was and says so, and Undo sends it back", async () => {
  await trashed("pyramid.jpg");
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Restore", exact: true }).click();

  await expect.element(screen.getByText("Restored pyramid.jpg to Cairo.")).toBeVisible();
  expect(await inCairo()).toContain("pyramid.jpg");

  await screen.getByRole("button", { name: "Undo" }).click();
  await expect.element(screen.getByText("pyramid.jpg is back in the Trash.")).toBeVisible();
  expect(await inCairo()).not.toContain("pyramid.jpg");
});

test("Restore to… puts it in the folder picked", async () => {
  await trashed("pyramid.jpg");
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Restore to…" }).click();
  const picker = screen.getByRole("dialog", { name: "Restore to" });
  await expect.element(picker.getByRole("combobox")).toHaveFocus();
  await userEvent.keyboard("peo{Enter}");

  await expect.element(screen.getByText("Restored pyramid.jpg to People.")).toBeVisible();
  expect((await folderItems(5)).map((row) => row.diskName)).toEqual(["pyramid.jpg"]);
});

test("a restore refused is the banner, and its row offers Restore to…", async () => {
  const pyramid = await trashed("pyramid.jpg");
  const sphinx = (await folderItems(6)).find((row) => row.diskName === "sphinx.jpg");
  if (!sphinx) throw new Error("the mock has no sphinx.jpg");
  await renameItem(sphinx.id, "pyramid.jpg");
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "Restore", exact: true }).click();

  await expect.element(screen.getByText("pyramid.jpg could not go back to Cairo")).toBeVisible();
  await expect.element(screen.getByText("Still in the Trash")).toBeVisible();
  await expect.element(screen.getByText("Name taken in Cairo")).toBeVisible();
  expect(getPaneItem()).toBe(pyramid);

  await screen.getByRole("button", { name: "Restore pyramid.jpg to…" }).click();
  await expect.element(screen.getByRole("dialog", { name: "Restore to" })).toBeVisible();
});

test("a file that stayed in the Trash after an undo is shown there, in the pane", async () => {
  const pyramid = await trashed("pyramid.jpg");
  showInPane(null);
  setPlace({ kind: "sorting" });
  const screen = await render(<Harness />);
  showReport({
    sentence: "3 of 5 files are back in Cairo",
    rows: [
      {
        kind: "file",
        id: pyramid,
        name: "pyramid.jpg",
        at: { kind: "trash" },
        reason: { kind: "inUse" },
      },
    ],
  });
  await screen.getByRole("button", { name: "Show pyramid.jpg in Trash" }).click();
  expect(getPlace()).toEqual(TRASH);
  expect(getPaneItem()).toBe(pyramid);
});

test("a trashed file's menu is the way back, and nothing that would act on a file not in the library", async () => {
  await trashed("pyramid.jpg");
  const screen = await render(<Harness />);
  const picture = screen.getByRole("complementary", { name: "Pane" }).getByRole("group", {
    name: "Zoom",
  });
  await expect.element(picture).toBeVisible();
  await picture.click({ button: "right" });
  const menu = screen.getByRole("menu", { name: "pyramid.jpg" });
  await expect.element(menu).toBeVisible();
  const rows = menu
    .getByRole("menuitem")
    .elements()
    .map((row) => row.querySelector(".truncate")?.textContent);
  expect(rows).toEqual(["Full Screen", "Restore", "Restore to…"]);
  expect(menu.element().querySelectorAll("hr")).toHaveLength(1);
});

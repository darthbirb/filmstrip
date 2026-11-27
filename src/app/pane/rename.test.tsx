import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { folderItems, trashItems, undoLast } from "../../ipc/commands";
import { Grid } from "../grid/Grid";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { type Place, setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { Pane } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { getPaneItem, showInPane } from "./pane-store";
import { stopRename } from "./rename";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg.

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
  stopRename();
  setNews(null);
  updatePreferences({ details: false });
  setPlace(CAIRO);
  resetIndex();
  await loadIndex();
  const pyramid = (await folderItems(6)).find((row) => row.diskName === "pyramid.jpg");
  showInPane(pyramid?.id ?? null, CAIRO);
});

afterEach(() => {
  stopRename();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

function Harness() {
  return (
    <PaneDetailProvider>
      <aside
        aria-label="Pane"
        style={{ display: "flex", flexDirection: "column", width: 420, height: 760 }}
      >
        <Pane />
      </aside>
      <Foot />
    </PaneDetailProvider>
  );
}

test("Rename in the ⋯ opens the details with the name as a field, its stem selected", async () => {
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "More" }).click();
  await screen.getByRole("menuitem", { name: "Rename" }).click();

  const field = screen.getByRole("textbox", { name: "Rename pyramid.jpg" });
  await expect.element(field).toHaveFocus();
  const input = field.element() as HTMLInputElement;
  expect(input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)).toBe("pyramid");

  await userEvent.keyboard("giza{Enter}");
  await expect.element(screen.getByText("Renamed pyramid.jpg to giza.jpg.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /giza\.jpg/ })).toBeVisible();
});

test("a name already taken says where, and Enter does nothing until the name changes", async () => {
  updatePreferences({ details: true });
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: /pyramid\.jpg/ }).click();
  await userEvent.keyboard("sphinx{Enter}");

  const said = screen.getByText("Cairo already has a file named sphinx.jpg.");
  await expect.element(said).toBeVisible();
  const field = screen.getByRole("textbox", { name: "Rename pyramid.jpg" });
  await expect.element(field).toHaveAttribute("aria-invalid", "true");
  await userEvent.keyboard("{Enter}");
  await expect.element(said).toBeVisible();

  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("button", { name: /pyramid\.jpg/ })).toBeVisible();
  expect((await folderItems(6)).map((row) => row.diskName)).toContain("pyramid.jpg");
});

test("F2 on a tile shows its file in the pane with the name as a field", async () => {
  await page.viewport(1300, 800);
  const screen = await render(
    <div style={{ display: "flex" }}>
      <div data-testid="grid" style={{ flex: "none", width: 800, height: 600 }}>
        <Grid mode="uniform" />
      </div>
      <Harness />
    </div>,
  );
  const sphinx = screen.getByTestId("grid").getByRole("button", { name: "sphinx.jpg" });
  await expect.element(sphinx).toBeVisible();
  (sphinx.element() as HTMLElement).focus();
  await userEvent.keyboard("{F2}");

  await expect.element(screen.getByRole("textbox", { name: "Rename sphinx.jpg" })).toHaveFocus();
  expect(getPaneItem()).toBe(
    (await folderItems(6)).find((row) => row.diskName === "sphinx.jpg")?.id,
  );
});

test("Shift+F2 on a tile, or F2 on a trashed one, renames nothing", async () => {
  await page.viewport(1300, 800);
  const pyramid = getPaneItem();
  const sphinx = (await folderItems(6)).find((row) => row.diskName === "sphinx.jpg")?.id ?? -1;
  const screen = await render(
    <div style={{ display: "flex" }}>
      <div data-testid="grid" style={{ flex: "none", width: 800, height: 600 }}>
        <Grid mode="uniform" />
      </div>
      <Harness />
    </div>,
  );
  const tile = () => screen.getByTestId("grid").getByRole("button", { name: "sphinx.jpg" });
  await expect.element(tile()).toBeVisible();
  (tile().element() as HTMLElement).focus();
  await userEvent.keyboard("{Shift>}{F2}{/Shift}");
  expect(getPaneItem()).toBe(pyramid);

  await trashItems([sphinx]);
  setPlace({ kind: "trash" });
  await expect.element(tile()).toBeVisible();
  (tile().element() as HTMLElement).focus();
  await userEvent.keyboard("{F2}");
  expect(getPaneItem()).toBe(pyramid);
  expect(screen.getByRole("textbox", { name: "Rename sphinx.jpg" }).query()).toBeNull();
});

test("Escape out of Rename from the ⋯ gives the focus back to the ⋯", async () => {
  const screen = await render(<Harness />);
  const pane = screen.getByRole("complementary", { name: "Pane" });
  await pane.getByRole("button", { name: "More" }).click();
  await pane.getByRole("menuitem", { name: "Rename" }).click();
  await expect.element(pane.getByRole("textbox", { name: "Rename pyramid.jpg" })).toHaveFocus();

  await userEvent.keyboard("{Escape}");
  await expect.element(pane.getByRole("button", { name: /pyramid\.jpg/ })).toBeVisible();
  await expect.element(pane.getByRole("button", { name: "More" })).toHaveFocus();
});

test("Enter on a new name in the Name row gives the focus back to the Name row", async () => {
  updatePreferences({ details: true });
  const screen = await render(<Harness />);
  const pane = screen.getByRole("complementary", { name: "Pane" });
  await pane.getByRole("button", { name: /pyramid\.jpg/ }).click();
  await expect.element(pane.getByRole("textbox", { name: "Rename pyramid.jpg" })).toHaveFocus();

  await userEvent.keyboard("giza{Enter}");
  await expect.element(pane.getByRole("button", { name: /giza\.jpg/ })).toHaveFocus();
});

test("Escape out of Rename from F2 gives the focus back to the tile", async () => {
  await page.viewport(1300, 800);
  const screen = await render(
    <div style={{ display: "flex" }}>
      <section aria-label="Grid" style={{ flex: "none", width: 800, height: 600 }}>
        <Grid mode="uniform" />
      </section>
      <Harness />
    </div>,
  );
  const sphinx = screen.getByRole("region", { name: "Grid" }).getByRole("button", {
    name: "sphinx.jpg",
  });
  await expect.element(sphinx).toBeVisible();
  (sphinx.element() as HTMLElement).focus();
  await userEvent.keyboard("{F2}");
  const pane = screen.getByRole("complementary", { name: "Pane" });
  await expect.element(pane.getByRole("textbox", { name: "Rename sphinx.jpg" })).toHaveFocus();

  await userEvent.keyboard("{Escape}");
  await expect.element(pane.getByRole("button", { name: /sphinx\.jpg/ })).toBeVisible();
  await expect.element(sphinx).toHaveFocus();
});

test("a click away from Rename leaves the focus where the click put it", async () => {
  const screen = await render(
    <>
      <Harness />
      <button type="button">Elsewhere</button>
    </>,
  );
  const pane = screen.getByRole("complementary", { name: "Pane" });
  await pane.getByRole("button", { name: "More" }).click();
  await pane.getByRole("menuitem", { name: "Rename" }).click();
  await expect.element(pane.getByRole("textbox", { name: "Rename pyramid.jpg" })).toHaveFocus();

  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  await elsewhere.click();
  await expect.element(pane.getByRole("button", { name: /pyramid\.jpg/ })).toBeVisible();
  await expect.element(elsewhere).toHaveFocus();
});

import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { folderItems, undoLast } from "../../ipc/commands";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { type Place, setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { Pane } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { showInPane } from "./pane-store";
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

function Harness() {
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex", flexDirection: "column", width: 420, height: 760 }}>
        <Pane />
      </div>
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

import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { failCommand } from "../../dev/mock";
import { withoutGlyphs } from "../../dev/words";
import { folderItems, renameSource } from "../../ipc/commands";
import { getNews, setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { type Place, setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { Settings } from "../settings/Settings";
import { closeSettings, openSettings, useSettingsRequest } from "../settings/settings-store";
import { Pane } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { showInPane } from "./pane-store";

// Against the dev mock: sphinx.jpg is in Cairo, under Trips, under the source Pictures.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

function SettingsFromStore() {
  const request = useSettingsRequest();
  return <Settings open={request !== null} onClose={closeSettings} section={request?.section} />;
}

function Harness() {
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex", width: 700, height: 760 }}>
        <nav style={{ width: 260 }}>
          <Navigation />
        </nav>
        <aside aria-label="Pane" style={{ display: "flex", flexDirection: "column", width: 400 }}>
          <Pane />
        </aside>
      </div>
      <SettingsFromStore />
    </PaneDetailProvider>
  );
}

/** A row of the details: its caption's value. */
function row(term: string) {
  const caption = [...document.querySelectorAll("dt")].find((dt) => dt.textContent === term);
  return caption?.nextElementSibling as HTMLElement | undefined;
}

const where = () => withoutGlyphs(row("Where")?.textContent ?? "");
const tags = () =>
  [...(row("Tags")?.querySelectorAll("[data-chip]") ?? [])].map((chip) =>
    withoutGlyphs(chip.textContent),
  );

async function inPane() {
  const sphinx = (await folderItems(6)).find((one) => one.diskName === "sphinx.jpg");
  if (!sphinx) throw new Error("the mock has no sphinx.jpg in Cairo");
  showInPane(sphinx.id, CAIRO);
  const screen = await render(<Harness />);
  await expect.poll(where).toBe("PicturesTripsCairo");
  expect(tags()).toContain("pictures");
  return screen;
}

beforeEach(async () => {
  await renameSource(1, "Pictures");
  closeSettings();
  setNews(null);
  setPlace(CAIRO);
  updatePreferences({ details: true });
  resetIndex();
  await loadIndex();
  await page.viewport(1200, 800);
});

test("renaming a source from its row retitles the file open in the pane", async () => {
  const screen = await inPane();
  await screen.getByRole("treeitem", { name: "Pictures 1 of 6" }).click({ button: "right" });
  await screen
    .getByRole("menu", { name: "Pictures" })
    .getByRole("menuitem", { name: "Rename" })
    .click();
  await expect.element(screen.getByRole("textbox", { name: "Rename Pictures" })).toHaveFocus();
  await userEvent.keyboard("{Control>}a{/Control}Holidays{Enter}");

  await expect.poll(where).toBe("HolidaysTripsCairo");
  expect(tags()).toContain("holidays");
  expect(tags()).not.toContain("pictures");
});

test("renaming a source in Settings retitles the file open in the pane", async () => {
  const screen = await inPane();
  openSettings({ section: "sources" });
  const section = screen.getByRole("region", { name: "Sources" });
  await section.getByRole("button", { name: "Pictures" }).click();
  await expect.element(section.getByRole("textbox", { name: "Rename Pictures" })).toHaveFocus();
  await userEvent.keyboard("{Control>}a{/Control}Summer{Enter}");

  await expect.poll(where).toBe("SummerTripsCairo");
  expect(tags()).toContain("summer");
  expect(tags()).not.toContain("pictures");
});

test("a rename that fails still says so, and the pane keeps the source's name", async () => {
  const screen = await inPane();
  failCommand("rename_source", { kind: "permissionDenied" });
  try {
    openSettings({ section: "sources" });
    const section = screen.getByRole("region", { name: "Sources" });
    await section.getByRole("button", { name: "Pictures" }).click();
    await userEvent.keyboard("{Control>}a{/Control}Summer{Enter}");

    await expect
      .poll(getNews)
      .toEqual({ kind: "failed", line: "Could not rename Pictures. Windows refused access." });
    expect(where()).toBe("PicturesTripsCairo");
  } finally {
    failCommand("rename_source", null);
  }
});

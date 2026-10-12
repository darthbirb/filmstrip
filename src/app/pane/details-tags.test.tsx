import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import { folderItems, itemTags, removeItemTag } from "../../ipc/commands";
import { type Place, setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { Pane } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { showInPane } from "./pane-store";

// Against the dev mock: sphinx.jpg is in Cairo, under Trips, under Pictures. Trips has the tag
// travel and the label trip:egypt 2024; Cairo has the tag egypt and the label location:cairo.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

let sphinx = 0;

beforeEach(async () => {
  sphinx = (await folderItems(6)).find((row) => row.diskName === "sphinx.jpg")?.id ?? -1;
  for (const tag of await itemTags(sphinx)) {
    if (tag.from === null) await removeItemTag(sphinx, tag.tagId);
  }
  setPlace(CAIRO);
  updatePreferences({ details: true });
  showInPane(sphinx, CAIRO);
  await page.viewport(1200, 800);
});

async function renderPane() {
  const screen = await render(
    <PaneDetailProvider>
      <div style={{ display: "flex", flexDirection: "column", width: 400, height: 760 }}>
        <Pane />
      </div>
    </PaneDetailProvider>,
  );
  await expect.element(screen.getByRole("button", { name: "Add Tag…" })).toBeVisible();
  return screen;
}

/** A row of the details: its caption's value. */
function row(term: string) {
  const caption = [...document.querySelectorAll("dt")].find((dt) => dt.textContent === term);
  return caption?.nextElementSibling as HTMLElement | undefined;
}

const chipTexts = (term: string) =>
  [...(row(term)?.querySelectorAll("[data-chip]") ?? [])].map((chip) =>
    withoutGlyphs(chip.textContent),
  );

const removable = () =>
  [...(row("Tags")?.querySelectorAll("button[data-removable]") ?? [])].map((chip) =>
    withoutGlyphs(chip.textContent),
  );

const PATH_ORDER = ["pictures", "trips", "travel", "cairo", "egypt"];

test("Add Tag… is the band's field: it offers the library's tags and stays open for the next", async () => {
  const screen = await renderPane();
  expect(chipTexts("Tags")).toEqual(PATH_ORDER);
  expect(removable()).toEqual([]);

  await screen.getByRole("button", { name: "Add Tag…" }).click();
  const field = screen.getByRole("combobox", { name: "Add Tag to sphinx.jpg" });
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("pe");
  await expect.element(screen.getByRole("option", { name: /^people/ })).toBeVisible();

  await userEvent.clear(field);
  await userEvent.keyboard("Felucca");
  await expect.element(screen.getByRole("option", { name: "New tag “felucca”" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => chipTexts("Tags")).toEqual(["felucca", ...PATH_ORDER]);
  await expect.element(field).toHaveFocus();
  await expect.element(field).toHaveValue("");

  await userEvent.keyboard("dawn{Enter}");
  await expect.poll(() => chipTexts("Tags")).toEqual(["felucca", "dawn", ...PATH_ORDER]);
  expect(removable()).toEqual(["felucca", "dawn"]);

  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("button", { name: "Add Tag…" })).toBeVisible();
});

test("a tag the file already carries is refused where it is typed, saying whose it is", async () => {
  const screen = await renderPane();
  await screen.getByRole("button", { name: "Add Tag…" }).click();
  await userEvent.keyboard("felucca{Enter}");
  await expect.poll(() => chipTexts("Tags")).toContain("felucca");

  const field = screen.getByRole("combobox", { name: "Add Tag to sphinx.jpg" });
  const refusals = [
    ["felucca", "sphinx.jpg already has felucca."],
    ["Egypt", "sphinx.jpg already has egypt, from Cairo."],
    ["cairo", "sphinx.jpg already has cairo, the name of Cairo."],
  ];
  for (const [typed, line] of refusals) {
    await userEvent.clear(field);
    await userEvent.type(field, typed ?? "");
    await expect.element(screen.getByText(line ?? "")).toBeVisible();
    await expect.element(field).toHaveAttribute("aria-invalid", "true");
  }
  await userEvent.keyboard("{Enter}");
  expect(chipTexts("Tags").filter((text) => text === "cairo")).toHaveLength(1);

  // What it carries is not offered again.
  await userEvent.clear(field);
  await userEvent.type(field, "tr");
  await expect.element(screen.getByRole("option", { name: "New tag “tr”" })).toBeVisible();
  expect(screen.getByRole("option", { name: /^(trips|travel)/ }).elements()).toHaveLength(0);
});

test("a file's own tag comes off with the keyboard or its ×; what it inherits does not", async () => {
  const screen = await renderPane();
  await screen.getByRole("button", { name: "Add Tag…" }).click();
  await userEvent.keyboard("felucca{Enter}dusk{Enter}");
  await expect.poll(() => removable()).toEqual(["felucca", "dusk"]);

  // Backspace in the empty field reaches the last own tag, and Delete takes it off.
  await userEvent.keyboard("{Backspace}");
  await expect.element(screen.getByRole("button", { name: "dusk", exact: true })).toHaveFocus();
  await userEvent.keyboard("{Delete}");
  await expect.poll(() => chipTexts("Tags")).toEqual(["felucca", ...PATH_ORDER]);
  await expect.element(screen.getByRole("button", { name: "pictures" })).toHaveFocus();
  await userEvent.keyboard("{Delete}");
  expect(chipTexts("Tags")).toContain("pictures");

  await screen.getByRole("button", { name: "felucca", exact: true }).hover();
  await screen.getByRole("button", { name: "Remove felucca" }).click();
  await expect.poll(() => chipTexts("Tags")).toEqual(PATH_ORDER);
  expect(await itemTags(sphinx)).not.toContainEqual(expect.objectContaining({ value: "felucca" }));
});

test("a file takes no label: its labels are its folders', each saying where it comes from", async () => {
  const screen = await renderPane();
  expect(chipTexts("Labels")).toEqual(["tripegypt 2024", "locationcairo"]);
  expect(row("Labels")?.querySelectorAll("button[data-removable]")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Add Label…" }).elements()).toHaveLength(0);
  await expect
    .element(screen.getByRole("button", { name: "location cairo" }))
    .toHaveAttribute("title", "From Cairo");
  await expect
    .element(screen.getByRole("button", { name: "cairo", exact: true }))
    .toHaveAttribute("title", "The name of Cairo");
});

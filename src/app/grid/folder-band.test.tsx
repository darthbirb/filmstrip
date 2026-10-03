import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import { folderDetail, removeFolderTag, setFolderStatus } from "../../ipc/commands";
import { Breadcrumb } from "../navigation/Breadcrumb";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { getPlace, type Place, setPlace } from "../place";
import { EmptyPlace } from "./EmptyPlace";
import { FolderBand } from "./FolderBand";
import { resetFolderDetail } from "./folder-detail";

// Against the dev mock: Pictures holds cover.jpg, People (empty) and Trips, which holds two files,
// the tag travel and the label trip:egypt 2024, and Cairo, which holds three, the tag egypt, the
// label location:cairo, a note, and the status Working. Archive is offline and knows Scans.

const PICTURES = { id: 1, title: "Pictures" };
const TRIPS = { id: 4, title: "Trips" };
const folderAt = (sourceId: number, ...path: { id: number; title: string }[]): Place => ({
  kind: "folder",
  sourceId,
  path,
});
const CAIRO = folderAt(1, PICTURES, TRIPS, { id: 6, title: "Cairo" });
const PEOPLE = folderAt(1, PICTURES, { id: 5, title: "People" });
const ARCHIVE = { id: 3, title: "Archive" };

beforeEach(async () => {
  resetIndex();
  resetFolderDetail();
  setPlace(null);
  await loadIndex();
  await setFolderStatus(6, "wip");
});

async function renderHeader(place: Place) {
  setPlace(place);
  await page.viewport(1200, 800);
  return render(
    <div style={{ width: 1000, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", height: 44, alignItems: "center" }}>
        <Breadcrumb />
      </div>
      <FolderBand />
    </div>,
  );
}

const details = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole("button", { name: "Details" });

/** A row of the band: its caption, then its value's text. */
function row(container: HTMLElement, term: string) {
  const caption = [...container.querySelectorAll("dt")].find((dt) => dt.textContent === term);
  return caption?.nextElementSibling as HTMLElement | undefined;
}

const chipTexts = (value: HTMLElement | undefined) =>
  [...(value?.querySelectorAll("[data-chip]") ?? [])].map((chip) =>
    withoutGlyphs(chip.textContent),
  );

/** Takes a tag a test added back off Cairo, so the next test starts from the mock's own. */
async function untag(value: string) {
  const tag = (await folderDetail(6))?.tags.find((one) => one.value === value && !one.from);
  if (tag) await removeFolderTag(6, tag.tagId);
}

test("a folder's header says its two counts in words, and its chevron opens the band", async () => {
  const screen = await renderHeader(CAIRO);
  await expect.element(screen.getByText("3 here · 3 in all")).toBeVisible();
  await expect.element(details(screen)).toHaveAttribute("aria-expanded", "false");
  const path = screen.getByText("Path", { exact: true });
  await expect.element(path).not.toBeVisible();

  await details(screen).click();
  await expect.element(details(screen)).toHaveAttribute("aria-expanded", "true");
  await expect.element(path).toBeVisible();
  expect(withoutGlyphs(row(screen.container, "Path")?.textContent)).toBe("D:\\PicturesTripsCairo");

  setPlace(folderAt(1, PICTURES, TRIPS));
  await expect.element(screen.getByText("2 here · 5 in all")).toBeVisible();
  setPlace(PEOPLE);
  await expect.element(screen.getByText("0 here · 0 in all")).toBeVisible();
});

test("the band reads in the pane's rhythm: status, labels, then tags, its own name first", async () => {
  const screen = await renderHeader(CAIRO);
  await details(screen).click();
  await expect.poll(() => row(screen.container, "Note")?.textContent).toMatch(/^Four mornings/);

  await expect.element(screen.getByRole("radio", { name: "Working" })).toBeChecked();
  expect(row(screen.container, "Status")?.textContent).toMatch(/set \d/);
  expect(chipTexts(row(screen.container, "Labels"))).toEqual(["locationcairo", "tripegypt 2024"]);
  expect(chipTexts(row(screen.container, "Tags"))).toEqual([
    "cairo",
    "egypt",
    "pictures",
    "trips",
    "travel",
  ]);
  const titled = (title: string) => withoutGlyphs(screen.getByTitle(title).element().textContent);
  expect(titled("The folder’s name · changes only when the folder is renamed")).toBe("cairo");
  expect(titled("The name of Trips")).toBe("trips");
  await expect.element(screen.getByTitle("From Trips").first()).toBeVisible();
});

test("a step of the band's path goes there, and the status is set from its group", async () => {
  const screen = await renderHeader(CAIRO);
  await details(screen).click();
  // A segment is its label: the radio inside it is out of sight.
  await screen.getByText("Complete", { exact: true }).click();
  await expect.element(screen.getByRole("radio", { name: "Complete" })).toBeChecked();

  await screen.getByText("No Status", { exact: true }).click();
  await expect.element(screen.getByRole("radio", { name: "No Status" })).toBeChecked();
  expect(row(screen.container, "Status")?.textContent).not.toMatch(/set /);

  await screen.getByRole("button", { name: "Trips", exact: true }).last().click();
  expect(getPlace()).toEqual(folderAt(1, PICTURES, TRIPS));
});

test("Favourite in the band marks the folder as navigation's menu does", async () => {
  const screen = await renderHeader(PEOPLE);
  await details(screen).click();
  const star = screen.getByRole("button", { name: "Favourite", exact: true });
  await expect.element(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect.element(star).toHaveAttribute("aria-pressed", "true");
  await expect.element(star).toHaveAttribute("title", "Remove Favourite");
  await star.click();
  await expect.element(star).toHaveAttribute("aria-pressed", "false");
});

test("an empty folder's band frames no picture and leaves out what it has none of", async () => {
  const screen = await renderHeader(PEOPLE);
  await details(screen).click();
  await expect
    .element(screen.getByTitle("Nothing in People to use as a cover"))
    .toBeInTheDocument();
  await expect.poll(() => chipTexts(row(screen.container, "Tags"))).toEqual(["people", "pictures"]);
  expect(row(screen.container, "Labels")).toBeUndefined();
  expect(row(screen.container, "Note")?.textContent).toBe("Add Note…");
});

test("a note is written in its row: Ctrl+Enter keeps it, Escape leaves it, emptied it goes", async () => {
  const screen = await renderHeader(PEOPLE);
  await details(screen).click();
  await screen.getByRole("button", { name: "Add Note…" }).click();
  const box = screen.getByRole("textbox", { name: "Note on People" });
  await expect.element(box).toHaveFocus();
  await userEvent.keyboard("Faces{Enter}and names{Control>}{Enter}{/Control}");
  const note = screen.getByRole("button", { name: "Change Note on People" });
  const said = () => withoutGlyphs(note.query()?.textContent);
  await expect.poll(said).toBe("Faces\nand names");

  // Escape leaves the note as it was; the caret had landed after what was written.
  await note.click();
  await expect.element(box).toHaveFocus();
  expect((box.element() as HTMLTextAreaElement).selectionStart).toBe("Faces\nand names".length);
  await userEvent.keyboard(" and more{Escape}");
  await expect.poll(said).toBe("Faces\nand names");

  // A click away keeps what was written.
  await note.click();
  await userEvent.keyboard(" kept");
  await screen.getByText("Path", { exact: true }).click();
  await expect.poll(said).toBe("Faces\nand names kept");

  // Emptied and saved, the note is gone.
  await note.click();
  await userEvent.clear(box);
  await screen.getByRole("button", { name: "Save" }).click();
  await expect.element(screen.getByRole("button", { name: "Add Note…" })).toBeVisible();
});

test("the pencil picks a cover from the branch, the first standing in until one is chosen", async () => {
  const screen = await renderHeader(CAIRO);
  await details(screen).click();
  const pencil = screen.getByRole("button", { name: "Choose Cover · now the first picture" });
  await pencil.click();
  const picker = screen.getByRole("listbox", { name: "Cover for Cairo" });
  await expect.element(picker).toBeVisible();
  expect(picker.getByRole("option").elements()).toHaveLength(3);
  const first = picker.getByRole("option", { name: "Picture 1 · First" });
  await expect.element(first).toHaveFocus();
  expect(screen.getByText("Clear Cover").elements()).toHaveLength(0);

  await userEvent.keyboard("{ArrowRight}{Enter}");
  await expect.poll(() => picker.query()).toBeNull();
  const change = screen.getByRole("button", { name: "Change Cover" });
  await expect.element(change).toHaveFocus();
  await expect.element(screen.getByText("Cover", { exact: true }).first()).toBeVisible();

  // Opened again, the chosen one has the keyboard, and down from the last row is Clear Cover.
  await change.click();
  await expect.element(picker.getByRole("option", { name: "Picture 2 · Cover" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => picker.query()).toBeNull();
  await change.click();
  await expect.element(picker.getByRole("option", { name: "Picture 2 · Cover" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(screen.getByRole("button", { name: /^Clear Cover/ })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(pencil).toBeVisible();
  expect(screen.getByText("Cover", { exact: true }).elements()).toHaveLength(0);
});

test("Add Tag… becomes a field that adds what is typed and stays open for the next", async () => {
  const screen = await renderHeader(CAIRO);
  await details(screen).click();
  await screen.getByRole("button", { name: "Add Tag…" }).click();
  const field = screen.getByRole("combobox", { name: "Add Tag to Cairo" });
  await expect.element(field).toHaveFocus();

  await userEvent.keyboard("pe");
  await expect.element(screen.getByRole("option", { name: /^people/ })).toBeVisible();
  await userEvent.clear(field);
  await userEvent.keyboard("Felucca");
  await expect.element(screen.getByRole("option", { name: "New tag “felucca”" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => chipTexts(row(screen.container, "Tags")))
    .toEqual(["cairo", "egypt", "felucca", "pictures", "trips", "travel"]);
  await expect.element(field).toHaveFocus();
  await expect.element(field).toHaveValue("");

  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("button", { name: "Add Tag…" })).toBeVisible();
  await untag("felucca");
});

test("a tag the folder already carries is refused where it is typed, saying whose it is", async () => {
  const screen = await renderHeader(CAIRO);
  await details(screen).click();
  await screen.getByRole("button", { name: "Add Tag…" }).click();
  const field = screen.getByRole("combobox", { name: "Add Tag to Cairo" });
  const refusals = [
    ["egypt", "Cairo already has egypt."],
    ["Travel", "Cairo already has travel, from Trips."],
    ["trips", "Cairo already has trips, the name of Trips."],
    ["cairo", "cairo is this folder’s name."],
  ];
  for (const [typed, line] of refusals) {
    await userEvent.clear(field);
    await userEvent.type(field, typed ?? "");
    await expect.element(screen.getByText(line ?? "")).toBeVisible();
    await expect.element(field).toHaveAttribute("aria-invalid", "true");
  }
  // Enter does nothing until the text changes.
  await userEvent.keyboard("{Enter}");
  expect(chipTexts(row(screen.container, "Tags")).filter((text) => text === "cairo")).toHaveLength(
    1,
  );
});

test("a folder's own tag is taken off with the keyboard; its name and what it inherits are not", async () => {
  const screen = await renderHeader(CAIRO);
  await details(screen).click();
  await screen.getByRole("button", { name: "Add Tag…" }).click();
  await userEvent.keyboard("dusk{Enter}");
  await expect.poll(() => chipTexts(row(screen.container, "Tags"))).toContain("dusk");
  const removable = () =>
    [...screen.container.querySelectorAll('button[data-chip="removable"]')].map((chip) =>
      withoutGlyphs(chip.textContent),
    );
  expect(removable()).toEqual(["egypt", "dusk"]);

  // Backspace in the empty field reaches the last own tag, and Delete takes it off.
  await userEvent.keyboard("{Backspace}");
  await expect.element(screen.getByRole("button", { name: "dusk", exact: true })).toHaveFocus();
  await userEvent.keyboard("{Delete}");
  await expect.poll(() => chipTexts(row(screen.container, "Tags"))).not.toContain("dusk");
  await expect.element(screen.getByRole("button", { name: "pictures" })).toHaveFocus();
  await userEvent.keyboard("{Delete}");
  expect(chipTexts(row(screen.container, "Tags"))).toContain("pictures");
});

test("a folder with nothing in it, or a drive that is away, has no pencil", async () => {
  const screen = await renderHeader(PEOPLE);
  await details(screen).click();
  await expect.element(screen.getByTitle("Nothing in People to use as a cover")).toBeVisible();
  expect(screen.getByRole("button", { name: /Cover/ }).elements()).toHaveLength(0);

  setPlace(folderAt(3, ARCHIVE));
  await expect
    .element(screen.getByTitle("Archive is offline · its pictures are on the drive"))
    .toBeVisible();
  expect(screen.getByRole("button", { name: /Cover/ }).elements()).toHaveLength(0);
});

test("a source's own band has no steps back, its path is its folder, and nothing comes down", async () => {
  const screen = await renderHeader(folderAt(1, PICTURES));
  await expect.element(screen.getByText("1 here · 6 in all")).toBeVisible();
  expect(
    screen.getByRole("navigation", { name: "Location" }).getByRole("button").elements(),
  ).toEqual([]);
  await details(screen).click();
  await expect.poll(() => row(screen.container, "Path")?.textContent).toBe("D:\\Pictures");
  expect(chipTexts(row(screen.container, "Tags"))).toEqual(["pictures"]);
  await expect
    .element(
      screen.getByTitle(
        "The source’s name · changes when the source is renamed in Settings or on its row",
      ),
    )
    .toBeVisible();
});

test("an offline source says so in place of its counts, and its band says when it was read", async () => {
  const screen = await renderHeader(folderAt(3, ARCHIVE));
  await expect.element(screen.getByText("offline", { exact: true })).toBeVisible();
  expect(screen.getByText(/ here · /).elements()).toHaveLength(0);
  await details(screen).click();
  await expect
    .element(screen.getByTitle("Archive is offline · its pictures are on the drive"))
    .toBeInTheDocument();
  expect(row(screen.container, "Path")?.textContent).toMatch(/^E:\\Archivelast indexed 4 March/);

  setPlace(folderAt(3, ARCHIVE, { id: 7, title: "Scans" }));
  await expect
    .element(screen.getByTitle("Scans is on Archive, which is offline"))
    .toBeInTheDocument();
  await expect
    .poll(() => row(screen.container, "Path")?.textContent)
    .toMatch(/^E:\\Archive\\Scanslast indexed/);
});

test("a folder below an offline source counts what it held when last indexed", async () => {
  const screen = await render(
    <EmptyPlace place={folderAt(3, ARCHIVE, { id: 7, title: "Scans" })} />,
  );
  await expect.element(screen.getByText("0 items in Scans when last indexed.")).toBeVisible();
});

test("the Sorting Box and the Trash keep a plain header with nothing to open", async () => {
  const screen = await renderHeader({ kind: "sorting" });
  await expect.element(screen.getByText("3 waiting")).toBeVisible();
  expect(screen.getByRole("button", { name: "Details" }).elements()).toHaveLength(0);

  setPlace({ kind: "trash" });
  await expect.element(screen.getByText("Trash", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "Details" }).elements()).toHaveLength(0);
});

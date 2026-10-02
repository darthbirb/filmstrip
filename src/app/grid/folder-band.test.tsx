import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import { setFolderStatus } from "../../ipc/commands";
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
  [...(value?.querySelectorAll("button") ?? [])].map((chip) => withoutGlyphs(chip.textContent));

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
  expect(row(screen.container, "Note")).toBeUndefined();
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

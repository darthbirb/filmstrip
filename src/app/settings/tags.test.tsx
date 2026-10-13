import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import {
  addItemTag,
  listTags,
  removeFolderTag,
  removeItemTag,
  setFolderLabel,
  undoLast,
} from "../../ipc/commands";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { getPlace, setPlace } from "../place";
import { Settings } from "./Settings";
import { getSettingsRequest, openSettings } from "./settings-store";
import { clashLine } from "./Tags";

// Against the dev mock: Pictures holds People and Trips, Trips holds Cairo with three files.
// Trips carries travel and `trip: egypt 2024`, Cairo egypt and `location: cairo`, and winter is a
// tag nothing carries.

beforeEach(async () => {
  await page.viewport(1280, 820);
  while (await undoLast()) {}
  setNews(null);
  setPlace(null);
  resetIndex();
  await loadIndex();
});

const opened = () => render(<Settings open onClose={() => undefined} section="tags" />);
const row = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("section[aria-label] [data-chip]")]
    .find((chip) => withoutGlyphs(chip.textContent) === name)
    ?.closest<HTMLElement>(".grid") ?? null;
const words = (name: string) => withoutGlyphs(row(name)?.textContent);
const values = async () => (await listTags()).tags.map((tag) => tag.value);
const more = (name: string) => page.getByRole("button", { name: `More for ${name}` });
const menuRow = (name: string) => page.getByRole("menuitem", { name });

test("the list counts what carries each tag, says whose name one is and marks the unused", async () => {
  await opened();
  await expect.element(page.getByText("10 tags · 2 keys")).toBeVisible();
  await expect.poll(() => words("egypt")).toBe("egypt31");
  expect(words("cairo")).toBe("caironame of Cairo31");
  expect(words("winter")).toBe("winterunused00");
  expect(words("trip")).toBe("trip1 value51");
  expect(row("cairo")?.querySelector("[aria-label^='More for']")).toBeNull();
  expect(row("egypt")?.querySelector("[aria-label='More for egypt']")).not.toBeNull();
});

test("the headings sort, and a second click reverses; the filter counts what it shows", async () => {
  await opened();
  const names = () =>
    [...document.querySelectorAll("section[aria-label='Tags in the library'] [data-chip]")].map(
      (chip) => withoutGlyphs(chip.textContent),
    );
  await expect.poll(names).toContain("winter");
  expect(names().slice(0, 3)).toEqual(["archive", "cairo", "egypt"]);
  await userEvent.click(page.getByRole("button", { name: "Sort by Files" }).first());
  expect(names()[0]).toBe("pictures");
  await userEvent.click(page.getByRole("button", { name: "Sort by Files" }).first());
  expect(names().at(-1)).toBe("pictures");

  await userEvent.fill(page.getByRole("searchbox", { name: "Filter tags and keys" }), "cai");
  await expect.element(page.getByText("2 of 14")).toBeVisible();
  expect(names()).toEqual(["cairo"]);
  expect(words("location")).toBe("location1 value31");
  await expect.element(page.getByTitle("Search location:cairo")).toBeVisible();

  await userEvent.fill(page.getByRole("searchbox", { name: "Filter tags and keys" }), "zebra");
  await expect.element(page.getByText("No Tags Match")).toBeVisible();
});

test("Rename… renames a tag everywhere, its line has Undo, and Undo puts it back", async () => {
  await opened();
  await userEvent.click(more("egypt"));
  await userEvent.click(menuRow("Rename…"));
  const field = page.getByRole("textbox", { name: "Rename egypt" });
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("Nile  Valley{Enter}");
  await expect.poll(values).toContain("nile valley");
  await expect
    .element(page.getByText("Renamed egypt to nile valley, on 3 files and 1 folder."))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Undo" }));
  await expect.poll(values).toContain("egypt");
  await expect.element(page.getByText("nile valley is egypt again.")).toBeVisible();
});

test("renaming onto a tag that exists asks to merge on the row, and Escape puts the row back", async () => {
  await opened();
  await userEvent.click(more("egypt"));
  await userEvent.click(menuRow("Rename…"));
  await userEvent.keyboard("{Control>}a{/Control}Travel{Enter}");
  const question = page.getByText(/travel is already a tag, on 5 files\. Merge egypt into it\?/);
  await expect.element(question).toBeVisible();
  await expect.element(page.getByText("Travel", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(question).not.toBeInTheDocument();
  await expect.element(more("egypt")).toHaveFocus();
  expect(await values()).toContain("egypt");

  await userEvent.click(more("egypt"));
  await userEvent.click(menuRow("Rename…"));
  await userEvent.keyboard("{Control>}a{/Control}travel{Enter}");
  await userEvent.click(page.getByRole("button", { name: "Merge Tags" }));
  await expect.poll(values).not.toContain("egypt");
  await expect
    .element(page.getByText("Merged egypt into travel, on 3 files and 1 folder."))
    .toBeVisible();
});

test("Merge Into… offers the library's tags, the row's own left out, and asks before it merges", async () => {
  await opened();
  await userEvent.click(more("egypt"));
  await userEvent.click(menuRow("Merge Into…"));
  await userEvent.keyboard("tr");
  const offers = page.getByRole("listbox");
  await expect.element(offers).toBeVisible();
  expect(withoutGlyphs(offers.element().textContent)).toBe("travelon 5 filestripson 5 files");
  await userEvent.click(page.getByRole("option", { name: /trips/ }));
  await expect.element(page.getByText(/trips is already a tag/)).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Merge Tags" }));
  await expect.poll(values).not.toContain("egypt");
});

test("Delete asks with its count first; an unused tag goes without asking", async () => {
  await opened();
  await userEvent.click(more("egypt"));
  await userEvent.click(menuRow("Delete Tag"));
  await expect
    .element(page.getByText("Delete egypt? It comes off 1 folder and the 3 files that carry it."))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Cancel" }));
  expect(await values()).toContain("egypt");
  await userEvent.click(more("egypt"));
  await userEvent.click(menuRow("Delete Tag"));
  await userEvent.click(page.getByRole("button", { name: "Delete Tag" }));
  await expect.poll(values).not.toContain("egypt");

  await userEvent.click(more("winter"));
  await userEvent.click(menuRow("Delete Tag"));
  await expect.poll(values).not.toContain("winter");
  await expect.element(page.getByText("Deleted winter.")).toBeVisible();
});

test("from the keyboard F2 renames and Delete asks, and Ctrl+Z in the section takes the act back", async () => {
  await opened();
  await expect.element(more("egypt")).toBeVisible();
  more("egypt").element().focus();
  await userEvent.keyboard("{F2}");
  await expect.element(page.getByRole("textbox", { name: "Rename egypt" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(more("egypt")).toHaveFocus();
  expect(document.querySelector("dialog[open]")).not.toBeNull();

  await userEvent.keyboard("{Delete}");
  await userEvent.click(page.getByRole("button", { name: "Delete Tag" }));
  await expect.poll(values).not.toContain("egypt");
  await userEvent.fill(page.getByRole("searchbox", { name: "Filter tags and keys" }), "e");
  await userEvent.keyboard("{Control>}z{/Control}");
  expect(await values()).not.toContain("egypt");
  await userEvent.fill(page.getByRole("searchbox", { name: "Filter tags and keys" }), "");
  (
    document.querySelector("section[aria-label='Tags in the library'] [data-chip]") as HTMLElement
  ).focus();
  await userEvent.keyboard("{Control>}z{/Control}");
  await expect.poll(values).toContain("egypt");
  await expect.element(page.getByText("egypt is back on 3 files and 1 folder.")).toBeVisible();
});

test("a click on a chip closes Settings and searches for it", async () => {
  openSettings({ section: "tags" });
  await opened();
  await userEvent.click(page.getByTitle("Search trip:*"));
  await expect.poll(() => getSettingsRequest()).toBeNull();
  const place = getPlace();
  expect(place?.kind === "search" ? place.query : null).toBe("trip:*");
});

test("a key merged where a branch would hold it twice is refused in the band's words", async () => {
  await opened();
  await userEvent.click(more("trip"));
  await userEvent.click(menuRow("Rename Key…"));
  await userEvent.keyboard("{Control>}a{/Control}location");
  await expect
    .element(page.getByText("Trips has a trip, and Cairo, inside Trips, already has a location."))
    .toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect((await listTags()).keys.map((key) => key.key)).toEqual(["location", "trip"]);

  await userEvent.keyboard("{Control>}a{/Control}journey{Enter}");
  await expect
    .poll(async () => (await listTags()).keys.map((key) => key.key))
    .toEqual(["journey", "location"]);
  await expect
    .element(page.getByText("Renamed trip to journey, on 5 files and 1 folder."))
    .toBeVisible();
});

test("a value's Merge Into… offers only its key's other values, and the merge asks first", async () => {
  await setFolderLabel(5, "location", "lisbon");
  try {
    await opened();
    await userEvent.click(page.getByRole("button", { name: "Show the values of location" }));
    await userEvent.click(more("location: lisbon"));
    await userEvent.click(menuRow("Merge Into…"));
    const offers = page.getByRole("listbox");
    await expect.element(offers).toBeVisible();
    expect(withoutGlyphs(offers.element().textContent)).toBe("cairoon 1 folder");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByText(/location: cairo is already a value, on 1 folder/))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Merge Values" }));
    await expect
      .poll(async () => (await listTags()).keys[0]?.values.map((value) => value.value))
      .toEqual(["cairo"]);
  } finally {
    while (await undoLast()) {}
    const lisbon = (await listTags()).keys[0]?.values.find((value) => value.value === "lisbon");
    if (lisbon) await removeFolderTag(5, lisbon.tagId);
  }
});

test("a key clash reads in the band's words, whichever way it runs", () => {
  expect(clashLine({ kind: "both", folder: "Lisbon" }, "season", "location")).toBe(
    "Lisbon already has a location.",
  );
  expect(clashLine({ kind: "above", folder: "Family", above: "People" }, "place", "owner")).toBe(
    "Family has a place, and owner comes from People.",
  );
});

test("at the window's least the counts keep their columns and a long name ends in an ellipsis", async () => {
  const long = "the long weekend at grandmother's house in alexandria";
  await addItemTag(1, long);
  try {
    await page.viewport(640, 480);
    await opened();
    await expect.poll(() => row(long)).not.toBeNull();
    const line = row(long) as HTMLElement;
    const chip = line.querySelector("[data-chip]") as HTMLElement;
    const [files, folders] = [...line.children].slice(1, 3) as HTMLElement[];
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    expect(files?.getBoundingClientRect().width).toBeCloseTo(3.25 * rem, 0);
    expect(folders?.getBoundingClientRect().width).toBeCloseTo(3.25 * rem, 0);
    expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(
      files?.getBoundingClientRect().left ?? 0,
    );
    const text = chip.querySelector(".truncate") as HTMLElement;
    expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
    expect(chip.title).toBe(`Search tag:"${long}"`);
  } finally {
    const own = (await listTags()).tags.find((tag) => tag.value === long);
    if (own) await removeItemTag(1, own.tagId);
  }
});

test("a key merged into another asks first and each folder keeps its value; Delete Key asks with its count", async () => {
  await setFolderLabel(5, "season", "winter");
  try {
    await opened();
    await userEvent.click(more("season"));
    await userEvent.click(menuRow("Merge Into…"));
    await userEvent.keyboard("loc{Enter}");
    await expect
      .element(
        page.getByText(
          "location is already a key, on 1 folder. Merge season into it? Its 1 folder keeps its value, as location: winter.",
        ),
      )
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Merge Keys" }));
    await expect
      .poll(async () => (await listTags()).keys.map((key) => key.key))
      .toEqual(["location", "trip"]);

    await userEvent.click(more("trip"));
    await userEvent.click(menuRow("Delete Key"));
    await expect
      .element(page.getByText("Delete trip? It comes off 1 folder and the 5 files under it."))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Delete Key" }));
    await expect
      .poll(async () => (await listTags()).keys.map((key) => key.key))
      .toEqual(["location"]);
  } finally {
    while (await undoLast()) {}
    const season = (await listTags()).keys.find((key) => key.key === "season")?.values[0];
    if (season) await removeFolderTag(5, season.tagId);
  }
});

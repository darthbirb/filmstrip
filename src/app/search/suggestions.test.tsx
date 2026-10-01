import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import { getPlace, type Place, setPlace } from "../place";
import { resetSearches } from "./results";
import { SearchField } from "./SearchField";
import { movePlate } from "./suggest";

// Against the dev mock, standing in Pictures / Trips with nothing scoped: `ca` begins the folder
// Cairo, the tag camel and the label location:cairo.

const TRIPS: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
  ],
};

function Bar() {
  return (
    <div style={{ display: "flex", width: 500, height: 28 }}>
      <SearchField />
    </div>
  );
}

beforeEach(() => {
  resetSearches();
  setPlace(TRIPS);
});

const field = () => page.getByRole("combobox", { name: "Search" });
const options = () => page.getByRole("option");
const rows = () =>
  options()
    .elements()
    .map((row) => withoutGlyphs(row.textContent));
const plated = () =>
  options()
    .elements()
    .map((row) => row.getAttribute("aria-selected") === "true");

async function type(text: string) {
  await render(<Bar />);
  await field().click();
  await userEvent.keyboard(text);
  await expect.element(options().first()).toBeVisible();
}

test("the list opens at the first key, not on focus, with each row's kind at its end", async () => {
  await render(<Bar />);
  await field().click();
  await expect.element(page.getByRole("button", { name: "Search Only in Trips" })).toBeVisible();
  expect(options().elements()).toHaveLength(0);
  await expect.element(field()).toHaveAttribute("aria-expanded", "false");

  await userEvent.keyboard("ca");
  await expect.element(options().first()).toBeVisible();
  // A folder is named by its whole path from the source.
  expect(rows()).toEqual([
    "caWords",
    "Pictures / Trips /CairoFolder",
    "camelTag",
    "locationcairoLabel",
  ]);
  await expect.element(field()).toHaveAttribute("aria-expanded", "true");
  expect(plated()).toEqual([false, false, false, false]);
});

test("↓ and ↑ move the plate while the caret stays in the field", async () => {
  await type("ca");
  await userEvent.keyboard("{ArrowDown}");
  expect(plated()).toEqual([true, false, false, false]);
  await expect.element(field()).toHaveFocus();
  await expect
    .element(field())
    .toHaveAttribute("aria-activedescendant", options().first().element().id);
  await userEvent.keyboard("{ArrowUp}");
  expect(plated()).toEqual([false, false, false, false]);
  await userEvent.keyboard("{ArrowUp}");
  expect(plated()).toEqual([false, false, false, true]);
  await expect.element(field()).toHaveValue("ca");
});

test("the plate steps off either end to no row", () => {
  expect(movePlate(null, 1, 3)).toBe(0);
  expect(movePlate(null, -1, 3)).toBe(2);
  expect(movePlate(2, 1, 3)).toBeNull();
  expect(movePlate(0, -1, 3)).toBeNull();
  expect(movePlate(null, 1, 0)).toBeNull();
});

test("Enter writes the plated term in place of the word and runs the query", async () => {
  await type("giza ca");
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
  expect(getPlace()).toEqual({ kind: "search", query: "giza tag:camel", back: TRIPS });
  await expect.element(page.getByTitle("tag:camel")).toBeVisible();
  await expect.element(field()).toHaveValue("giza");
  expect(options().elements()).toHaveLength(0);
});

test("Tab on a plated row picks it rather than the offer, and Enter with none runs the words", async () => {
  await type("ca");
  await userEvent.keyboard("{ArrowUp}{Tab}");
  expect(getPlace()).toMatchObject({ query: "location:cairo" });

  setPlace(TRIPS);
  await field().click();
  await userEvent.keyboard("ca");
  await expect.element(options().first()).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(getPlace()).toMatchObject({ query: "ca" });
});

test("a folder picked becomes the scope, and the other words stay", async () => {
  await type("giza ca");
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  expect(getPlace()).toEqual({
    kind: "search",
    query: "path:Pictures/Trips/Cairo giza",
    back: TRIPS,
  });
  await expect.element(page.getByTitle("Pictures / Trips / Cairo")).toBeVisible();
  expect(page.getByTitle("Pictures / Trips", { exact: true }).elements()).toHaveLength(0);
});

test("a click on a row picks it", async () => {
  await type("ca");
  await options().nth(2).click();
  expect(getPlace()).toMatchObject({ query: "tag:camel" });
});

test("Escape closes the list and keeps what was typed; the next leaves the field", async () => {
  await type("ca");
  await userEvent.keyboard("{Escape}");
  expect(options().elements()).toHaveLength(0);
  await expect.element(field()).toHaveFocus();
  await expect.element(field()).toHaveValue("ca");
  await userEvent.keyboard("{Escape}");
  await expect.element(field()).not.toHaveFocus();
  expect(getPlace()).toEqual(TRIPS);
});

test("a typed key narrows the list to its kind", async () => {
  await type("tag:d");
  expect(rows()).toEqual(["dawnTag", "duskTag"]);
});

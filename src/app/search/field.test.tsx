import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import { getPlace, type Place, setPlace } from "../place";
import { faultSentence } from "./fault";
import { useSearchKeys } from "./keys";
import { resetSearches } from "./results";
import { SearchField } from "./SearchField";

// Against the dev mock, whose reader takes each word as a path, a place, a tag, a label or a word.

const TRIPS: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
  ],
};

function Bar() {
  useSearchKeys();
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

const field = () => page.getByRole("searchbox", { name: "Search" });
const chips = () =>
  [...document.querySelectorAll("[title]")]
    .filter((one) => one.closest("div")?.contains(field().element()))
    .map((one) => withoutGlyphs(one.textContent));

test("at rest it is the word Search; Ctrl+F puts the caret in it and writes where you stand first", async () => {
  const screen = await render(<Bar />);
  await expect.element(screen.getByText("Search", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Control>}f{/Control}");
  await expect.element(field()).toHaveFocus();
  await expect.element(screen.getByTitle("Pictures / Trips")).toBeVisible();
  expect(withoutGlyphs(screen.getByTitle("Pictures / Trips").element().textContent)).toBe("Trips");
  expect(screen.getByText("Search", { exact: true }).elements()).toHaveLength(0);
});

test("a term becomes its chip once a space closes it, words stay words, and Enter runs the query", async () => {
  const screen = await render(<Bar />);
  await field().click();
  await userEvent.keyboard("tag:dawn giza");
  await expect.element(screen.getByTitle("tag:dawn")).toBeVisible();
  await expect.element(field()).toHaveValue("giza");
  await userEvent.keyboard("{Enter}");
  expect(getPlace()).toEqual({
    kind: "search",
    query: "path:Pictures/Trips tag:dawn giza",
    back: TRIPS,
  });
  await expect.element(field()).not.toHaveFocus();
});

test("Backspace at the start plates the last chip, and a second press removes it", async () => {
  const screen = await render(<Bar />);
  await field().click();
  await userEvent.keyboard("tag:dawn ");
  const dawn = screen.getByTitle("tag:dawn");
  await expect.element(dawn).toBeVisible();
  await userEvent.keyboard("{Backspace}");
  await expect.element(dawn).toHaveClass(/bg-plate/);
  await userEvent.keyboard("{Backspace}");
  expect(screen.getByTitle("tag:dawn").elements()).toHaveLength(0);
  await expect.element(screen.getByTitle("Pictures / Trips")).toBeVisible();
});

test("a query that does not read runs nothing and says which character, until Escape takes it back", async () => {
  const screen = await render(<Bar />);
  await field().click();
  await userEvent.keyboard("giza (sphinx");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("alert").getByText("The ( after giza is never closed."))
    .toBeVisible();
  await expect.element(field()).toHaveAttribute("aria-invalid", "true");
  expect(getPlace()).toEqual(TRIPS);
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("alert").elements()).toHaveLength(0);
  await expect.element(field()).toHaveValue("giza (sphinx");
  await userEvent.keyboard("{Escape}");
  await expect.element(field()).not.toHaveFocus();
  await expect.element(screen.getByText("Search", { exact: true })).toBeVisible();
});

test("standing in results, the field holds the query that made them", async () => {
  setPlace({ kind: "search", query: "path:Pictures/Trips cairo", back: TRIPS });
  const screen = await render(<Bar />);
  await expect.element(screen.getByTitle("Pictures / Trips")).toBeVisible();
  await expect.element(field()).toHaveValue("cairo");
  setPlace(TRIPS);
  await expect.element(screen.getByText("Search", { exact: true })).toBeVisible();
  expect(chips()).toEqual([]);
});

test("each fault is said in its own words", () => {
  expect(faultSentence({ kind: "unclosedQuote", before: "old" })).toBe(
    "The quote before old is never closed.",
  );
  expect(faultSentence({ kind: "unclosedGroup", after: null })).toBe("The ( is never closed.");
  expect(faultSentence({ kind: "unopenedGroup" })).toBe("The ) closes nothing.");
  expect(faultSentence({ kind: "badValue", key: "year", value: "abcd" })).toBe(
    "year: cannot take abcd.",
  );
  expect(faultSentence({ kind: "empty" })).toBeNull();
});

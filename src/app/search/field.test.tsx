import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import { loadIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
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

const field = () => page.getByRole("combobox", { name: "Search" });
const chips = () =>
  [...document.querySelectorAll("span[title]")]
    .filter((one) => one.closest("div")?.contains(field().element()))
    .map((one) => withoutGlyphs(one.textContent));

const offer = () => page.getByRole("button", { name: "Search Only in Trips" });

test("at rest it is the word Search; Ctrl+F puts the caret in it and offers where you stand", async () => {
  const screen = await render(<Bar />);
  await expect.element(screen.getByText("Search", { exact: true })).toBeVisible();
  expect(offer().elements()).toHaveLength(0);
  await userEvent.keyboard("{Control>}f{/Control}");
  await expect.element(field()).toHaveFocus();
  await expect.element(offer()).toBeVisible();
  expect(withoutGlyphs(offer().element().textContent)).toBe("in TripsTab");
  expect(screen.getByTitle("Pictures / Trips").elements()).toHaveLength(0);
  expect(screen.getByText("Search", { exact: true }).elements()).toHaveLength(0);
});

test("Tab takes the offer as the first term, and removing that term offers it again", async () => {
  const screen = await render(<Bar />);
  await field().click();
  await userEvent.keyboard("giza{Tab}");
  const scope = screen.getByTitle("Pictures / Trips");
  await expect.element(scope).toBeVisible();
  await expect.element(field()).toHaveFocus();
  expect(offer().elements()).toHaveLength(0);
  await userEvent.keyboard("{Enter}");
  expect(getPlace()).toMatchObject({ query: "path:Pictures/Trips giza" });

  setPlace(TRIPS);
  await field().click();
  await offer().click();
  await expect.element(screen.getByTitle("Pictures / Trips")).toBeVisible();
  await expect.element(field()).toHaveFocus();
  await screen.getByRole("button", { name: "Remove path:Pictures/Trips" }).click();
  await expect.element(offer()).toBeVisible();
});

test("the Sorting Box and the Trash offer themselves, each as its own term", async () => {
  setPlace({ kind: "trash" });
  await render(<Bar />);
  await field().click();
  await userEvent.click(page.getByRole("button", { name: "Search Only in Trash" }));
  await userEvent.keyboard("dawn{Enter}");
  expect(getPlace()).toMatchObject({ query: "is:trashed dawn" });

  setPlace({ kind: "sorting" });
  await field().click();
  await userEvent.keyboard("{Tab}dawn{Enter}");
  expect(getPlace()).toMatchObject({ query: "is:sorting dawn" });
});

test("a term becomes its chip once a space closes it, words stay words, and Enter runs the query", async () => {
  const screen = await render(<Bar />);
  await field().click();
  await userEvent.keyboard("tag:dawn giza");
  await expect.element(screen.getByTitle("tag:dawn")).toBeVisible();
  await expect.element(field()).toHaveValue("giza");
  await userEvent.keyboard("{Enter}");
  expect(getPlace()).toEqual({ kind: "search", query: "tag:dawn giza", back: TRIPS });
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
  expect(chips()).toEqual([]);
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

test("Search in Folder writes that folder as the scope, keeps the words, and runs nothing", async () => {
  await loadIndex();
  const screen = await render(
    <>
      <Bar />
      <div style={{ width: 280 }}>
        <Navigation />
      </div>
    </>,
  );
  await screen.getByRole("treeitem", { name: "Pictures 1 of 6" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await screen.getByRole("treeitem", { name: "Trips 2 of 5" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await field().click();
  await userEvent.keyboard("giza{Tab}");
  await expect.element(screen.getByTitle("Pictures / Trips")).toBeVisible();

  // A right-click opens the folder's menu without going there.
  await screen.getByRole("treeitem", { name: "Cairo 3 of 3" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Search in Folder" }).click();

  // The folder took the scope's place; the words stayed, the caret is in the field, nothing ran.
  await expect.element(screen.getByTitle("Pictures / Trips / Cairo")).toBeVisible();
  expect(screen.getByTitle("Pictures / Trips", { exact: true }).elements()).toHaveLength(0);
  await expect.element(field()).toHaveFocus();
  await expect.element(field()).toHaveValue("giza");
  expect(getPlace()?.kind).toBe("folder");
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

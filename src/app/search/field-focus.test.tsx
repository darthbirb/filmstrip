import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import { getPlace, type Place, setPlace } from "../place";
import { useSearchKeys } from "./keys";
import { resetSearches } from "./results";
import { SearchField } from "./SearchField";
import { goBack } from "./search";

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
    <div>
      <section aria-label="Bar" style={{ display: "flex", width: 500, height: 28 }}>
        <SearchField />
      </section>
      <main aria-label="Grid">
        <button type="button">Tile</button>
      </main>
    </div>
  );
}

beforeEach(() => {
  resetSearches();
  setPlace(TRIPS);
});

afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  setPlace(null);
});

async function renderBar() {
  const screen = await render(<Bar />);
  const bar = screen.getByRole("region", { name: "Bar" });
  const grid = screen.getByRole("main", { name: "Grid" });
  return {
    field: bar.getByRole("combobox", { name: "Search" }),
    offer: bar.getByRole("button", { name: "Search Only in Trips" }),
    tile: grid.getByRole("button", { name: "Tile" }),
    scope: bar.getByTitle("Pictures / Trips"),
  };
}

test("Escape twice leaves the field for wherever the focus was before Ctrl+F", async () => {
  const { field, tile } = await renderBar();
  (tile.element() as HTMLElement).focus();
  await userEvent.keyboard("{Control>}f{/Control}");
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("d");
  await userEvent.keyboard("{Escape}");
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(tile).toHaveFocus();
  await expect.element(field).toHaveValue("");
});

test("back from results to a folder, the second Escape empties the field", async () => {
  setPlace({ kind: "search", query: "egy", back: TRIPS });
  const { field, tile } = await renderBar();
  await expect.element(field).toHaveValue("egy");
  goBack();
  await expect.element(field).toHaveValue("");

  (tile.element() as HTMLElement).focus();
  await userEvent.keyboard("{Control>}f{/Control}x");
  await expect.element(field).toHaveValue("x");
  await userEvent.keyboard("{Escape}{Escape}");
  await expect.element(tile).toHaveFocus();
  await expect.element(field).toHaveValue("");
  expect(getPlace()).toEqual(TRIPS);
});

test("in results, the second Escape gives back the query the grid shows", async () => {
  setPlace({ kind: "search", query: "egy", back: TRIPS });
  const { field, tile } = await renderBar();
  await expect.element(field).toHaveValue("egy");
  (tile.element() as HTMLElement).focus();
  await userEvent.keyboard("{Control>}f{/Control}{End}pt");
  await expect.element(field).toHaveValue("egypt");
  await userEvent.keyboard("{Escape}{Escape}");
  await expect.element(tile).toHaveFocus();
  await expect.element(field).toHaveValue("egy");
  expect(getPlace()).toMatchObject({ kind: "search", query: "egy" });
});

test("an empty field passes Tab on and writes nothing; once typed, Tab takes the offer", async () => {
  const { field, offer, tile, scope } = await renderBar();
  (tile.element() as HTMLElement).focus();
  await userEvent.keyboard("{Control>}f{/Control}");
  await expect.element(offer).toBeVisible();
  expect(withoutGlyphs(offer.element().textContent)).toBe("in Trips");
  await userEvent.keyboard("{Tab}");
  await expect.element(tile).toHaveFocus();
  await expect.element(scope).not.toBeInTheDocument();
  await expect.element(field).toHaveValue("");

  await field.click();
  await userEvent.keyboard("giza");
  await expect.element(offer).toBeVisible();
  expect(withoutGlyphs(offer.element().textContent)).toBe("in TripsTab");
  await userEvent.keyboard("{Tab}");
  await expect.element(scope).toBeVisible();
  await expect.element(field).toHaveFocus();
});

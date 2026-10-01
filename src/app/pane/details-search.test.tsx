import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { EffectiveTag } from "../../ipc/bindings/EffectiveTag";
import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { folderItems, itemDetail } from "../../ipc/commands";
import { getPlace, type Place, setPlace } from "../place";
import { resetSearches } from "../search/results";
import { Details } from "./Details";

// Against the dev mock's reader, which takes each word of a query as its own term.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

const TAGS: EffectiveTag[] = [
  { tagId: 1, key: "location", value: "cairo", originId: null, originTitle: null },
  { tagId: 2, key: null, value: "sphinx", originId: null, originTitle: null },
  { tagId: 3, key: null, value: "egypt", originId: 4, originTitle: "Trips" },
];

async function sphinx() {
  const row = (await folderItems(6)).find((item) => item.diskName === "sphinx.jpg");
  return (await itemDetail(row?.id ?? -1)) as ItemDetail;
}

async function details() {
  await render(
    <div style={{ width: 380 }}>
      <Details item={await sphinx()} tags={TAGS} />
    </div>,
  );
}

const chip = (name: string) => page.getByRole("button", { name, exact: true });

beforeEach(() => {
  resetSearches();
  setPlace(CAIRO);
});

test("each label and tag says what a click will search for", async () => {
  await details();
  await expect.element(chip("location cairo")).toHaveAttribute("title", "Search location: cairo");
  await expect.element(chip("sphinx")).toHaveAttribute("title", "Search sphinx");
  await expect.element(chip("egypt")).toHaveAttribute("title", "Search egypt");
});

test("a click asks anew from everywhere, with that term alone", async () => {
  setPlace({ kind: "search", query: "path:Pictures/Trips/Cairo dawn", back: CAIRO });
  await details();
  await chip("location cairo").click();
  expect(getPlace()).toEqual({ kind: "search", query: "location:cairo", back: CAIRO });

  // An inherited tag searches the same way, and Enter is the click.
  (chip("egypt").element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  expect(getPlace()).toMatchObject({ query: "tag:egypt", back: CAIRO });
});

test("Ctrl+Click adds the term and keeps the query, scope and all, but never twice", async () => {
  setPlace({ kind: "search", query: "path:Pictures/Trips/Cairo dawn", back: CAIRO });
  await details();
  await userEvent.click(chip("sphinx"), { modifiers: ["Control"] });
  await expect
    .poll(() => getPlace())
    .toEqual({ kind: "search", query: "path:Pictures/Trips/Cairo dawn tag:sphinx", back: CAIRO });

  await userEvent.click(chip("sphinx"), { modifiers: ["Control"] });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(getPlace()).toMatchObject({ query: "path:Pictures/Trips/Cairo dawn tag:sphinx" });
});

test("Ctrl+Click standing in a folder, with no query yet, asks for the term alone", async () => {
  await details();
  await userEvent.click(chip("sphinx"), { modifiers: ["Control"] });
  await expect.poll(() => getPlace()).toEqual({ kind: "search", query: "tag:sphinx", back: CAIRO });
});

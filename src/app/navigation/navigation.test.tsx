import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { getPlace, setPlace } from "../place";
import { Breadcrumb } from "./Breadcrumb";
import { loadIndex, resetIndex } from "./index-store";
import { Navigation } from "./Navigation";

// Against the dev mock: Pictures holds People and Trips › Cairo; Incoming is a sorting source
// holding three items; Archive cannot be reached.
const titles = () => {
  const place = getPlace();
  return place?.kind === "folder" ? place.path.map((crumb) => crumb.title) : place?.kind;
};

beforeEach(async () => {
  resetIndex();
  setPlace(null);
  await loadIndex();
});

test("shows the Sorting Box with its count, every library source, and the Trash", async () => {
  const screen = await render(<Navigation />);
  await expect.element(screen.getByRole("treeitem", { name: "Sorting Box 3" })).toBeVisible();
  await expect.element(screen.getByRole("treeitem", { name: "Pictures" })).toBeVisible();
  await expect.element(screen.getByRole("treeitem", { name: "Archive offline" })).toBeVisible();
  await expect.element(screen.getByRole("treeitem", { name: "Trash" })).toBeVisible();
});

test("a source opens in place, and choosing a folder goes there", async () => {
  const screen = await render(<Navigation />);
  const row = (name: string) => screen.getByRole("treeitem", { name });
  await expect.poll(() => row("Pictures").element().getAttribute("aria-expanded")).toBe("false");

  await row("Pictures").click();
  await userEvent.keyboard("{ArrowRight}");
  await row("Trips").click();
  expect(titles()).toEqual(["Pictures", "Trips"]);
  await userEvent.keyboard("{ArrowRight}");
  await row("Cairo").click();
  expect(titles()).toEqual(["Pictures", "Trips", "Cairo"]);
  await expect.element(row("Cairo")).toHaveAttribute("aria-selected", "true");

  await row("Sorting Box 3").click();
  expect(titles()).toBe("sorting");
});

test("the breadcrumb goes back up to any folder on the path", async () => {
  setPlace({
    kind: "folder",
    sourceId: 1,
    path: [
      { id: 1, title: "Pictures" },
      { id: 4, title: "Trips" },
      { id: 6, title: "Cairo" },
    ],
  });
  const screen = await render(<Breadcrumb />);
  await expect.element(screen.getByText("Cairo")).toHaveAttribute("aria-current", "location");

  await screen.getByRole("button", { name: "Pictures" }).click();
  expect(titles()).toEqual(["Pictures"]);
});

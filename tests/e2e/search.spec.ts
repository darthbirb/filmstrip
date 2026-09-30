import { expect, test } from "@playwright/test";

test("a search typed in a folder stands in its results, opens one, widens, acts on one, and goes back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");

  const tree = page.getByRole("tree", { name: "Places" });
  await tree.getByRole("treeitem", { name: "Pictures" }).click();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "Trips 2" }).click();

  // Ctrl+F writes where you stand, and Enter runs what was typed after it.
  await page.keyboard.press("Control+f");
  const field = page.getByRole("combobox", { name: "Search" });
  await expect(field).toBeFocused();
  await field.pressSequentially("cairo");
  await page.keyboard.press("Enter");

  const grid = page.getByRole("main");
  await expect(grid.getByRole("heading", { name: "Folders · 1" })).toBeVisible();
  await expect(grid.getByRole("heading", { name: "Files · 3" })).toBeVisible();
  await expect(page.getByText("1 folder · 3 files")).toBeVisible();

  await grid.getByRole("button", { name: "pyramid.jpg" }).click();
  const pane = page.getByRole("complementary", { name: "Pane" });
  await expect(pane.getByRole("heading", { name: "pyramid.jpg" })).toBeAttached();

  await page.getByRole("button", { name: "Search Everywhere" }).click();
  await expect(field).toHaveValue("cairo");
  await expect(page.getByTitle("Pictures / Trips")).toHaveCount(0);

  await grid.getByRole("button", { name: "sphinx.jpg" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("Deleted sphinx.jpg.")).toBeVisible();
  await expect(grid.getByRole("button", { name: "sphinx.jpg" })).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(grid.getByRole("button", { name: "sphinx.jpg" })).toBeVisible();

  await grid.getByRole("button", { name: "Back to Trips · Escape" }).click();
  await expect(grid.getByRole("button", { name: "hotel.jpg" })).toBeVisible();
  await expect(page.getByText("Search", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

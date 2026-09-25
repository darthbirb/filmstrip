import { expect, test } from "@playwright/test";

test("a key bound from a folder's menu moves the file in the pane there, and Ctrl+Z brings it back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");

  const tree = page.getByRole("tree", { name: "Places" });
  await tree.getByRole("treeitem", { name: "Pictures" }).click();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "People" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Assign Key…/ }).click();
  const keys = page.getByRole("menu", { name: "Key for People" });
  await keys.getByRole("menuitem").first().click();
  await expect(
    tree.getByRole("treeitem", { name: "People" }).getByTitle("Destination Key 1"),
  ).toBeVisible();

  await tree.getByRole("treeitem", { name: "Trips 2" }).click();
  const grid = page.getByRole("main");
  await grid.getByRole("button", { name: "hotel.jpg" }).click();
  await page.keyboard.press("1");

  await expect(page.getByText("Moved hotel.jpg to People.")).toBeVisible();
  await expect(grid.getByRole("button", { name: "hotel.jpg" })).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(page.getByText("hotel.jpg is back in Trips.")).toBeVisible();
  await expect(grid.getByRole("button", { name: "hotel.jpg" })).toBeVisible();
  expect(errors).toEqual([]);
});

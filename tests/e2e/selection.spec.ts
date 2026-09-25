import { expect, test } from "@playwright/test";

test("files checked in the grid move together from the bar, and Ctrl+Z brings them all back", async ({
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

  const grid = page.getByRole("main");
  await grid.getByRole("checkbox", { name: "Check boarding-pass.png" }).click();
  await grid.getByRole("button", { name: "hotel.jpg" }).click({ modifiers: ["Control"] });

  const bar = page.getByRole("toolbar", { name: "Selection" });
  await expect(bar.getByText("2 Files", { exact: true }).last()).toBeVisible();
  await bar.getByRole("button", { name: "Move to…" }).click();
  await expect(page.getByRole("dialog", { name: "Move to" }).getByRole("combobox")).toBeFocused();
  await page.keyboard.type("peo");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Moved 2 files to People.")).toBeVisible();
  await expect(grid.getByRole("button", { name: "hotel.jpg" })).toHaveCount(0);
  await expect(bar).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(page.getByText("2 files are back in Trips.")).toBeVisible();
  await expect(grid.getByRole("button", { name: "hotel.jpg" })).toBeVisible();
  // What an undo brings back comes back unchecked.
  await expect(grid.getByRole("checkbox", { name: "Check hotel.jpg" })).not.toBeChecked();
  expect(errors).toEqual([]);
});

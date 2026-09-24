import { expect, test } from "@playwright/test";

test("a file deleted waits in the Trash under today, and Restore puts it back where it was", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");

  const grid = page.getByRole("main");
  await grid.getByRole("button", { name: "cover.jpg" }).click();
  await page
    .getByRole("toolbar", { name: "Actions" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByText("Deleted cover.jpg.")).toBeVisible();

  const tree = page.getByRole("tree", { name: "Places" });
  await tree.getByRole("treeitem", { name: "Trash 1" }).click();
  await expect(grid.getByRole("heading", { name: "Today" })).toBeVisible();
  await grid.getByRole("button", { name: "cover.jpg" }).click();

  const bar = page.getByRole("toolbar", { name: "Actions" });
  await bar.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("Restored cover.jpg to Pictures.")).toBeVisible();
  await expect(grid.getByRole("button", { name: "cover.jpg" })).toHaveCount(0);
  await expect(tree.getByRole("treeitem", { name: "Trash", exact: true })).toBeVisible();

  await tree.getByRole("treeitem", { name: "Pictures" }).click();
  await expect(grid.getByRole("button", { name: "cover.jpg" })).toBeVisible();
  expect(errors).toEqual([]);
});

import { expect, test } from "@playwright/test";

test("a folder's band opens from its header, keeps a status, a tag and a cover, and the tag finds its files", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");

  const tree = page.getByRole("tree", { name: "Places" });
  await tree.getByRole("treeitem", { name: "Pictures 1 of 6" }).click();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "Trips 2 of 5" }).click();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "Cairo 3 of 3" }).click();

  const grid = page.getByRole("main");
  await expect(grid.getByText("3 here · 3 in all")).toBeVisible();
  await grid.getByRole("button", { name: "Details" }).click();
  await expect(grid.getByText("Path", { exact: true })).toBeVisible();

  await grid.getByText("Complete", { exact: true }).click();
  await expect(grid.getByRole("radio", { name: "Complete" })).toBeChecked();

  await grid.getByRole("button", { name: "Add Tag…" }).click();
  await page.keyboard.type("felucca");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("button", { name: "felucca", exact: true })).toBeVisible();

  await grid.getByRole("button", { name: "Choose Cover · now the first picture" }).click();
  await page.getByRole("option", { name: "Picture 3" }).click();
  await expect(grid.getByText("Cover", { exact: true }).first()).toBeVisible();
  await grid.getByRole("button", { name: "Change Cover" }).click();
  await page.getByRole("button", { name: /^Clear Cover/ }).click();
  await expect(
    grid.getByRole("button", { name: "Choose Cover · now the first picture" }),
  ).toBeVisible();

  // The band stays open on the next folder, and the tag searches for the files that carry it.
  await grid.getByRole("button", { name: "felucca", exact: true }).click();
  await expect(grid.getByRole("heading", { name: "felucca 3 files" })).toBeVisible();
  await expect(grid.getByRole("button", { name: "sphinx.jpg" })).toBeVisible();
  expect(errors).toEqual([]);
});

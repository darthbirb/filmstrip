import { expect, test } from "@playwright/test";

test("a folder deleted into the sorting source goes with its files, and Ctrl+Z brings it back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");

  const tree = page.getByRole("tree", { name: "Places" });
  await tree.getByRole("treeitem", { name: "Pictures" }).click();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "Trips 2" }).click({ button: "right" });
  await page.getByRole("menu", { name: "Trips" }).getByRole("menuitem", { name: "Delete" }).click();

  const question = page.getByRole("region", { name: "Trips holds 5 files" });
  await expect(question).toBeFocused();
  await question.getByRole("button", { name: "Move Files to Incoming" }).click();

  await expect(page.getByText("Deleted Trips. Its 5 files are in Incoming.")).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Trips 2" })).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(page.getByText("Trips and its 5 files are back in Pictures.")).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Trips 2" })).toBeVisible();
  expect(errors).toEqual([]);
});

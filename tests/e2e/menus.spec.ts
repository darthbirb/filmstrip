import { expect, test } from "@playwright/test";

test("a real right-click on a tile opens its menu at the pointer, and Favourite reaches the bar", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");
  const tile = page.getByRole("button", { name: "cover.jpg" });
  await tile.click();
  const box = await tile.boundingBox();
  if (!box) throw new Error("the grid is not showing cover.jpg");

  await page.mouse.click(box.x + 30, box.y + 40, { button: "right" });
  const menu = page.getByRole("menu", { name: "cover.jpg" });
  await expect(menu).toBeVisible();
  const opened = await menu.boundingBox();
  expect(opened?.x).toBeCloseTo(box.x + 30, 0);
  expect(opened?.y).toBeCloseTo(box.y + 40, 0);

  await menu.getByRole("menuitem", { name: "Favourite" }).click();
  await expect(menu).toHaveCount(0);
  const bar = page.getByRole("toolbar", { name: "Actions" });
  await expect(bar.getByRole("button", { name: "Remove Favourite" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Shift+F10 on a focused tree row opens its menu under the row, and Escape gives the row back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");
  const row = page.getByRole("treeitem", { name: "Pictures" });
  await row.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Pictures" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "New Folder" })).toBeFocused();

  const [under, opened] = [await row.boundingBox(), await menu.boundingBox()];
  const rem = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  expect(opened?.x).toBeCloseTo(under?.x ?? 0, 0);
  // The ring's 2px and its 2px gap, then a tile-gap.
  expect((opened?.y ?? 0) - ((under?.y ?? 0) + (under?.height ?? 0))).toBeCloseTo(
    4 + 0.375 * rem,
    0,
  );

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();
});

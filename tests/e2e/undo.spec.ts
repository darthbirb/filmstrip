import { expect, test } from "@playwright/test";

test("a file moved by the picker says so at the foot, and Ctrl+Z puts it back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");
  await page.getByRole("button", { name: "cover.jpg" }).click();

  const bar = page.getByRole("toolbar", { name: "Actions" });
  await bar.getByRole("button", { name: "Move to…" }).click();
  const picker = page.getByRole("dialog", { name: "Move to" });
  await expect(picker.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("peo");
  await page.keyboard.press("Enter");

  const grid = page.getByRole("main");
  await expect(page.getByText("Moved cover.jpg to People.")).toBeVisible();
  await expect(grid.getByRole("button", { name: "cover.jpg" })).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(page.getByText("cover.jpg is back in Pictures.")).toBeVisible();
  await expect(grid.getByRole("button", { name: "cover.jpg" })).toBeVisible();
  expect(errors).toEqual([]);
});

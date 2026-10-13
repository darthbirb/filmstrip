import { expect, test } from "@playwright/test";

for (const width of [1440, 900, 640]) {
  test(`at ${width}px a tag merged in Settings › Tags keeps its line at the foot of navigation once Settings closes`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 640 ? 480 : 860 });
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Tags" }).click();
    await expect(settings.getByText("10 tags · 2 keys")).toBeVisible();

    await settings.getByRole("button", { name: "More for egypt" }).click();
    await page.getByRole("menuitem", { name: "Merge Into…" }).click();
    await page.keyboard.type("trav");
    await page.keyboard.press("Enter");
    await settings.getByRole("button", { name: "Merge Tags" }).click();
    const line = "Merged egypt into travel, on 3 files and 1 folder.";
    await expect(settings.getByText(line)).toBeVisible();
    await expect(settings.getByText("9 tags · 2 keys")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const foot = page.getByRole("navigation", { name: "Navigation" });
    await expect(foot.getByText(line)).toBeVisible();
    await page.keyboard.press("Control+z");
    await expect(foot.getByText("egypt is back on 3 files and 1 folder.")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

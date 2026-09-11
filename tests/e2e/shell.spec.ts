import { expect, test } from "@playwright/test";

const WIDTHS = [640, 1024, 1440, 1920];

test("the shell renders cleanly at every width", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`shell-${width}.png`) });
  }

  expect(errors).toEqual([]);
});

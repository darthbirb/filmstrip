import { expect, test } from "@playwright/test";

const WIDTHS = [640, 1024, 1920];
const ROOT_SIZES = ["16px", "24px"];

test("the shell fits at every width and text size", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  for (const width of WIDTHS) {
    for (const rootSize of ROOT_SIZES) {
      await page.setViewportSize({ width, height: 600 });
      await page.goto("/");
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, rootSize);

      const banner = page.getByRole("banner");
      await expect(page.getByRole("button", { name: "Close" })).toBeInViewport();
      expect(await banner.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`shell-${width}-${rootSize}.png`) });
    }
  }

  expect(errors).toEqual([]);
});

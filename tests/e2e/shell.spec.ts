import { expect, test } from "@playwright/test";

const WIDTHS = [640, 1024, 1920];
const ROOT_SIZES = ["16px", "24px"];

test("the shell fits at every width and text size", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("filmstrip:candidate:grid", "justified");
  });

  for (const width of WIDTHS) {
    for (const rootSize of ROOT_SIZES) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto("/");
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, rootSize);

      await expect(page.getByRole("button", { name: "Close" })).toBeInViewport();
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Pictures");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`shell-${width}-${rootSize}.png`) });
    }
  }

  expect(errors).toEqual([]);
});

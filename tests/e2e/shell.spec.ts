import { expect, test } from "@playwright/test";

const FRAMES = ["columns", "toolbar", "floating"];
const WIDTHS = [640, 1024, 1920];
const ROOT_SIZES = ["16px", "24px"];

function collectErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

for (const frame of FRAMES) {
  test(`the ${frame} frame fits at every width and text size`, async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await page.addInitScript((name) => {
      localStorage.setItem("filmstrip:candidate:frame", name);
    }, frame);

    for (const width of WIDTHS) {
      for (const rootSize of ROOT_SIZES) {
        await page.setViewportSize({ width, height: 700 });
        await page.goto("/");
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, rootSize);

        await expect(page.getByRole("button", { name: "Close" })).toBeInViewport();
        await expect(page.getByRole("main")).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBe(0);
        await page.screenshot({ path: testInfo.outputPath(`${frame}-${width}-${rootSize}.png`) });
      }
    }

    expect(errors).toEqual([]);
  });
}

test("the comparison stacks every frame at full width", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await expect(page.getByRole("main")).toHaveCount(FRAMES.length);
  expect(errors).toEqual([]);
});

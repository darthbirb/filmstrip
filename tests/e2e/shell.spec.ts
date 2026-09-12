import { expect, test } from "@playwright/test";

const NAVIGATIONS = ["tree", "places", "drill"];
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

for (const nav of NAVIGATIONS) {
  test(`the shell with ${nav} navigation fits at every width and text size`, async ({
    page,
  }, testInfo) => {
    const errors = collectErrors(page);
    await page.addInitScript((name) => {
      localStorage.setItem("filmstrip:candidate:navigation", name);
    }, nav);

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
        await page.screenshot({ path: testInfo.outputPath(`${nav}-${width}-${rootSize}.png`) });
      }
    }

    expect(errors).toEqual([]);
  });
}

test("the comparison shows every navigation side by side", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  for (const nav of NAVIGATIONS) {
    await expect(page.getByRole("region", { name: nav }).getByRole("tree").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

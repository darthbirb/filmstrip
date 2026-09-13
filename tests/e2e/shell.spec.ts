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

test("every look fits, shows a clicked picture in the pane, and draws its specimen", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

  for (const look of ["layered", "darkroom", "greycard"]) {
    for (const width of [1024, 1920]) {
      for (const rootSize of ROOT_SIZES) {
        await page.setViewportSize({ width, height: 700 });
        await page.goto("/");
        await page.evaluate((name) => {
          localStorage.setItem("filmstrip:candidate:look", name);
          localStorage.setItem("filmstrip:specimen", "0");
        }, look);
        await page.reload();
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, rootSize);

        await page.getByRole("button", { name: "cover.jpg" }).click();
        // A pane that did not fit is folded to its rail, and opens over the grid.
        const show = page.getByRole("button", { name: "Show pane" });
        if (await show.isVisible()) await show.click();
        const pane = page.getByRole("complementary", { name: "Pane" });
        await expect(pane.getByRole("heading", { name: "cover.jpg" })).toBeVisible();
        expect(await overflow()).toBe(0);
        await page.screenshot({
          path: testInfo.outputPath(`look-${look}-${width}-${rootSize}.png`),
        });
      }
    }

    await page.evaluate(() => localStorage.setItem("filmstrip:specimen", "1"));
    await page.reload();
    await expect(page.getByRole("main", { name: "Specimen" })).toBeVisible();
    expect(await overflow()).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`specimen-${look}.png`), fullPage: true });
  }

  expect(errors).toEqual([]);
});

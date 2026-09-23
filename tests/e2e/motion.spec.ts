import { expect, type Page, test } from "@playwright/test";

const PANEL = 'aside[aria-label="Pane"]';
const DETAILS = "#pane-details";

/** A picture in the pane with its details open: the two surfaces every move here is measured on. */
async function openTheDetails(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "cover.jpg" }).click();
  const pane = page.getByRole("complementary", { name: "Pane" });
  const row = pane.getByRole("button", { name: /×/ });
  if ((await row.getAttribute("aria-expanded")) === "false") await row.click();
  await expect(page.locator(DETAILS)).not.toHaveCSS("visibility", "hidden");
  return pane;
}

test("a box changing size takes one duration and the content under it another", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 700 });
  const pane = await openTheDetails(page);

  await expect(pane).toHaveCSS("transition-duration", /0\.18s/);
  await expect(page.locator(DETAILS).locator("xpath=../..")).toHaveCSS(
    "transition-duration",
    /0\.18s/,
  );
  // The cross-fade under a fold is the longer of the two, so the box settles first.
  await expect(pane.locator("xpath=./div").first()).toHaveCSS("transition-duration", /0\.22s/);
});

test("under reduced motion a box lands in the frame it changes in", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1920, height: 700 });
  const pane = await openTheDetails(page);

  // Two frames is far short of the 180ms the same move takes when motion is allowed.
  const details = await page.evaluate(async (selector) => {
    // The push-down itself, since the box it clips keeps its own padding whatever its height.
    const pushDown = document.querySelector(selector)?.parentElement?.parentElement;
    const box = () => pushDown?.getBoundingClientRect().height ?? 0;
    const opened = box();
    document.querySelector<HTMLElement>('[aria-expanded="true"]')?.click();
    await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)));
    return { opened, shut: box() };
  }, DETAILS);
  expect(details.opened).toBeGreaterThan(0);
  expect(details.shut).toBe(0);

  const panel = await page.evaluate(async (selector) => {
    const box = () => document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    const docked = box();
    document.querySelector<HTMLElement>('button[aria-label="Hide Pane"]')?.click();
    await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)));
    return { docked, folded: box() };
  }, PANEL);
  expect(panel.docked).toBeGreaterThan(panel.folded);
  // Straight to the rail, with nothing of the width left to travel.
  const rail = await pane.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).getPropertyValue("--spacing-rail")),
  );
  const rem = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  expect(panel.folded).toBeCloseTo(rail * rem, 0);
});

test("nothing animates on first paint", async ({ page }) => {
  // Narrow enough that the pane folds as soon as the frame measures itself, which is the risk.
  await page.setViewportSize({ width: 700, height: 700 });
  await page.addInitScript(() => {
    const moves: string[] = [];
    Object.defineProperty(window, "moves", { get: () => moves });
    document.addEventListener("transitionstart", (event) => {
      moves.push((event as TransitionEvent).propertyName);
    });
  });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Show Pane" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { moves: string[] }).moves)).toEqual([]);
});

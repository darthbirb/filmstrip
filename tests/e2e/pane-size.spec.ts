import { expect, type Page, test } from "@playwright/test";

/** A tall picture in the pane: the shape whose height, not width, decides what fits. */
async function showThePortrait(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "cover.jpg" }).click();
  const pane = page.getByRole("complementary", { name: "Pane" });
  await expect(pane.getByRole("img", { name: "cover.jpg" })).toBeVisible();
  return pane;
}

/** Where the picture starts and ends, against the actions below it: the pane's claim about its own room. */
async function clears(page: Page) {
  const pane = page.getByRole("complementary", { name: "Pane" });
  const picture = await pane.getByRole("img", { name: "cover.jpg" }).boundingBox();
  const actions = await page.getByRole("toolbar", { name: "Actions" }).boundingBox();
  if (!picture || !actions) throw new Error("the pane is not showing a picture and its actions");
  return {
    top: picture.y,
    bottom: picture.y + picture.height,
    height: picture.height,
    actions: actions.y,
  };
}

/** The same, once every transition has finished: full screen and the details both change size over time. */
async function settled(page: Page) {
  await page.evaluate(async () => {
    // A frame first, so a transition the last click started has been created before it is waited on.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
  });
  return clears(page);
}

test("a picture keeps to its own room in full screen, and gives way to the details", async ({
  page,
}) => {
  const pane = await showThePortrait(page);
  await pane.getByRole("button", { name: "Full screen" }).click();
  const full = await settled(page);
  expect(full.bottom).toBeLessThanOrEqual(full.actions);

  await pane.getByRole("button", { expanded: false }).first().click();
  await expect(page.locator("#pane-details")).not.toHaveCSS("visibility", "hidden");
  const opened = await settled(page);
  expect(opened.bottom).toBeLessThanOrEqual(opened.actions);
  // The details take room from the top, so a picture filling the height shrinks and starts under them.
  expect(opened.height).toBeLessThan(full.height);
  const details = await page.locator("#pane-details").boundingBox();
  expect(opened.top).toBeGreaterThanOrEqual((details?.y ?? 0) + (details?.height ?? 0));
});

test("a picture keeps to its own room in the docked pane", async ({ page }) => {
  await showThePortrait(page);
  const docked = await clears(page);
  expect(docked.bottom).toBeLessThanOrEqual(docked.actions);
});

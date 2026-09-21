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

/** Whether the picture ends above the actions, which is the pane's whole claim about its own room. */
async function clears(page: Page) {
  const pane = page.getByRole("complementary", { name: "Pane" });
  const picture = await pane.getByRole("img", { name: "cover.jpg" }).boundingBox();
  const actions = await page.getByRole("toolbar", { name: "Actions" }).boundingBox();
  if (!picture || !actions) throw new Error("the pane is not showing a picture and its actions");
  return { bottom: picture.y + picture.height, actions: actions.y };
}

test("a picture keeps to its own room in full screen, and gives way to the details", async ({
  page,
}) => {
  const pane = await showThePortrait(page);
  await pane.getByRole("button", { name: "Full screen" }).click();
  const full = await clears(page);
  expect(full.bottom).toBeLessThanOrEqual(full.actions);

  const details = pane.getByRole("button", { expanded: false }).first();
  await details.click();
  await expect(page.locator("#pane-details")).not.toHaveCSS("visibility", "hidden");
  const opened = await clears(page);
  expect(opened.bottom).toBeLessThanOrEqual(opened.actions);
  expect(opened.bottom).toBeLessThan(full.bottom);
});

test("a picture keeps to its own room in the docked pane", async ({ page }) => {
  await showThePortrait(page);
  const docked = await clears(page);
  expect(docked.bottom).toBeLessThanOrEqual(docked.actions);
});

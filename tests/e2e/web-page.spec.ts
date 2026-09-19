import { expect, type Page, test } from "@playwright/test";

/** Presses on one point and carries the pointer to another, as a person dragging would. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

const selected = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

test("dragging from navigation into the grid selects no text", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 860 });
  await page.goto("/");
  const caption = await page.getByText("Library", { exact: true }).boundingBox();
  const foot = await page.getByText(/items · \d+ sources/).boundingBox();
  const title = await page.getByRole("main").getByText("Pictures").first().boundingBox();
  if (!caption || !foot || !title) throw new Error("navigation and the grid should be on screen");

  // From the words at either end of navigation, out across its edge into the grid's header.
  await drag(
    page,
    { x: caption.x + 2, y: caption.y + caption.height / 2 },
    { x: title.x + title.width, y: title.y + 4 },
  );
  expect(await selected(page)).toBe("");
  await drag(
    page,
    { x: foot.x + 2, y: foot.y + foot.height / 2 },
    { x: title.x + title.width, y: title.y + 4 },
  );
  expect(await selected(page)).toBe("");
});

test("a field still selects its own text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const field = page.getByRole("searchbox", { name: "Find a setting" });
  await field.fill("interface");
  await field.selectText();
  const picked = await field.evaluate((el: HTMLInputElement) =>
    el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
  );
  expect(picked).toBe("interface");
});

test("right-click opens no browser menu, except in a field", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("treeitem", { name: "Pictures" })).toBeVisible();
  const rightClick = (selector: string) =>
    page.evaluate((at) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      document.querySelector(at)?.dispatchEvent(event);
      return event.defaultPrevented;
    }, selector);

  expect(await rightClick('[role="treeitem"]')).toBe(true);
  expect(await rightClick("main")).toBe(true);
  await page.getByRole("button", { name: "Settings" }).click();
  expect(await rightClick('input[type="search"]')).toBe(false);
});

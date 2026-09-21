import { expect, type Page, test } from "@playwright/test";

const NAV = 'nav[aria-label="Navigation"]';

/** Drags the splitter left in small steps, reporting how wide navigation was after each one. */
async function dragNarrower(page: Page, steps: number) {
  const splitter = page.getByRole("separator", { name: "Resize navigation" });
  const grip = await splitter.boundingBox();
  if (!grip) throw new Error("navigation has no splitter");
  const width = () =>
    page.evaluate(
      (selector) =>
        Math.round(document.querySelector(selector)?.getBoundingClientRect().width ?? 0),
      NAV,
    );

  await page.mouse.move(grip.x + 2, grip.y + 200);
  await page.mouse.down();
  const seen: number[] = [];
  for (let step = 0; step < steps; step++) {
    await page.mouse.move(grip.x - step * 10, grip.y + 200);
    await page.waitForTimeout(50);
    seen.push(await width());
  }
  await page.mouse.up();
  return seen;
}

test("a panel being dragged narrower never pushes back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("treeitem", { name: "Pictures" })).toBeVisible();

  // A width that grows while the pointer only ever moves left is the panel fighting it.
  const seen = await dragNarrower(page, 18);
  const pushes = seen.filter((width, at) => at > 0 && width > (seen[at - 1] ?? 0) + 1);
  expect(pushes, `widths: ${seen.join(",")}`).toEqual([]);
  expect(seen.at(-1)).toBeLessThan(seen[0] ?? 0);
});

test("the doorway keeps its whole label at the narrowest navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?no-sources");
  const add = page.getByRole("button", { name: "Add a folder…" });
  await expect(add).toBeVisible();

  await dragNarrower(page, 18);
  const label = await add.evaluate((button) => {
    const text = button.querySelector(".truncate") as HTMLElement;
    return {
      cut: text.scrollWidth - text.clientWidth,
      height: button.getBoundingClientRect().height,
    };
  });

  expect(label.cut, "nothing is cut off the label").toBeLessThanOrEqual(0);
  expect(label.height, "the label is on one line").toBeLessThan(40);
});

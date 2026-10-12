import { expect, type Page, test } from "@playwright/test";

async function openDetailsOfSphinx(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");

  const tree = page.getByRole("tree", { name: "Places" });
  await tree.getByRole("treeitem", { name: "Pictures 1 of 6" }).click();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "Trips 2 of 5" }).click();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "Cairo 3 of 3" }).click();

  const grid = page.getByRole("main");
  await grid.getByRole("button", { name: "sphinx.jpg" }).click();
  const pane = page.getByRole("complementary", { name: "Pane" });
  const row = pane.getByRole("button", { name: /×/ });
  if ((await row.getAttribute("aria-expanded")) === "false") await row.click();
  const details = pane.getByRole("region", { name: "Details" });
  return { grid, details, errors };
}

test("a file takes a tag in the pane's details, the tag finds it, and it comes off again", async ({
  page,
}) => {
  const { grid, details, errors } = await openDetailsOfSphinx(page);

  await details.getByRole("button", { name: "Add Tag…" }).click();
  await page.keyboard.type("Felucca");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const felucca = details.getByRole("button", { name: "felucca", exact: true });
  await expect(felucca).toBeVisible();

  await felucca.click();
  await expect(grid.getByRole("heading", { name: "felucca 1 file" })).toBeVisible();
  await expect(grid.getByRole("button", { name: "sphinx.jpg" })).toBeVisible();
  await expect(grid.getByRole("button", { name: "pyramid.jpg" })).toHaveCount(0);

  await felucca.focus();
  await page.keyboard.press("Delete");
  await expect(felucca).toHaveCount(0);
  await expect(details.getByRole("button", { name: "egypt", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a tag of several words is kept lowercase, one space apart, and its chip finds the file", async ({
  page,
}) => {
  const { grid, details, errors } = await openDetailsOfSphinx(page);

  await details.getByRole("button", { name: "Add Tag…" }).click();
  await page.keyboard.type("New  York");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const tag = details.getByRole("button", { name: "new york", exact: true });
  await expect(tag).toBeVisible();

  await tag.click();
  await expect(grid.getByRole("heading", { name: "new york 1 file" })).toBeVisible();
  await expect(grid.getByRole("button", { name: "sphinx.jpg" })).toBeVisible();
  await expect(grid.getByRole("button", { name: "pyramid.jpg" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

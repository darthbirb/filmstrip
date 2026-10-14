import { expect, type Page, test } from "@playwright/test";

/** cover.jpg put on the clipboard by its own menu's Copy, as Explorer's Copy would put a file. */
async function copyCover(page: Page) {
  await page.getByRole("button", { name: "cover.jpg" }).click({ button: "right" });
  await page
    .getByRole("menu", { name: "cover.jpg" })
    .getByRole("menuitem", { name: "Copy", exact: true })
    .click();
}

/** Text in the foot's slot; the folded rail's own foot, out of sight, repeats it after. */
const said = (page: Page, text: string) => page.getByText(text).first();

for (const width of [1440, 900]) {
  test(`at ${width}px a file pasted into a folder comes in under its own name, is refused a second time, and goes to the Trash on Ctrl+Z`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/");
    await copyCover(page);

    await page.getByRole("treeitem", { name: /^Pictures / }).click();
    await page.keyboard.press("ArrowRight");
    const people = page.getByRole("treeitem", { name: /^People / });
    await people.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "People" });
    await menu.getByRole("menuitem", { name: "Paste 1 File" }).click();
    await expect(said(page, "Copied cover.jpg to People.")).toBeVisible();

    await people.click();
    const grid = page.getByRole("main");
    await expect(grid.getByRole("button", { name: "cover.jpg", exact: true })).toBeVisible();

    // The name is now taken in People: the copy is refused and reported, never renamed.
    await page.keyboard.press("Control+v");
    await expect(page.getByText("cover.jpg could not come into People")).toBeVisible();
    await expect(page.getByText("Name taken in People")).toBeVisible();
    await expect(grid.getByRole("button", { name: "cover.jpg", exact: true })).toHaveCount(1);

    await page.keyboard.press("Control+z");
    await expect(said(page, "cover.jpg left People for the Trash.")).toBeVisible();
    await expect(grid.getByRole("button", { name: "cover.jpg", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("Ctrl+V into the folder the files came from copies nothing and says why", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");
  await copyCover(page);

  await page.getByRole("treeitem", { name: /^Pictures / }).click();
  await page.keyboard.press("Control+v");
  await expect(said(page, "Already in Pictures.")).toBeVisible();
  await expect(said(page, "The file on the clipboard is Pictures’ own.")).toBeVisible();
});

test("Ctrl+V with nothing copied says the clipboard holds no files, and the line goes at the next key", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");
  await page.getByRole("treeitem", { name: /^Pictures / }).click();
  await page.keyboard.press("Control+v");
  await expect(said(page, "The clipboard holds no files.")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("The clipboard holds no files.")).toHaveCount(0);
});

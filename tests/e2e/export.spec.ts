import { expect, type Page, test } from "@playwright/test";

/** Text in the foot's slot; the folded rail's own foot, out of sight, repeats it after. */
const said = (page: Page, text: string) => page.getByText(text).first();

for (const width of [1440, 900]) {
  test(`at ${width}px a folder exported from its row is written as a job, and a second zip of the same name is refused`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/");

    await page.getByRole("treeitem", { name: /^Pictures / }).click();
    await page.keyboard.press("ArrowRight");
    const trips = page.getByRole("treeitem", { name: /^Trips / });
    await trips.click({ button: "right" });
    await page
      .getByRole("menu", { name: "Trips" })
      .getByRole("menuitem", { name: "Export…" })
      .click();

    const sheet = page.getByRole("dialog", { name: "Trips · 5 Files" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Trips.zip")).toBeVisible();
    await sheet.getByText("From Folders").click();
    await expect(sheet.getByText(/^Trips - \d{4}(-\d\d){5}\.png$/)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(sheet).toHaveCount(0);

    await expect(said(page, "Exporting Trips.zip…")).toBeVisible();
    await expect(said(page, "Exported 5 files to Trips.zip.")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Show in Explorer" }).first()).toBeVisible();

    await trips.click({ button: "right" });
    await page
      .getByRole("menu", { name: "Trips" })
      .getByRole("menuitem", { name: "Export…" })
      .click();
    await expect(said(page, "Filmstrip never replaces a file.")).toBeVisible();
    await expect(said(page, "Trips.zip is already in Exports.")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Trips · 5 Files" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

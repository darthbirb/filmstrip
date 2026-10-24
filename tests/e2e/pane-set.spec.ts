import { expect, test } from "@playwright/test";

test("files dragged onto the pane join what it shows, and Escape there shows the first alone", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");

  const tree = page.getByRole("tree", { name: "Places" });
  await tree.getByRole("treeitem", { name: "Pictures 1 of 6" }).click();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "Trips 2 of 5" }).click();

  const grid = page.getByRole("main");
  const pane = page.getByRole("complementary", { name: "Pane" });
  const hotel = grid.getByRole("button", { name: "hotel.jpg" });
  const pass = grid.getByRole("button", { name: "boarding-pass.png" });
  await hotel.click();
  await expect(pane.getByRole("heading", { name: "hotel.jpg" })).toBeAttached();

  const from = await pass.boundingBox();
  const to = await pane.boundingBox();
  if (!from || !to) throw new Error("the tile or the pane is not on screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.getByText("Add 1 file to the pane")).toBeVisible();
  await page.mouse.up();

  const set = pane.getByRole("group", { name: "2 Files" });
  await expect(set).toBeVisible();
  await expect(pane.getByText(/^2 Files · /)).toBeVisible();
  await expect(hotel).toHaveAttribute("aria-current", "true");
  await expect(pass).toHaveAttribute("aria-current", "true");

  await set.getByRole("button", { name: "boarding-pass.png" }).focus();
  await page.keyboard.press("Escape");
  await expect(set).toHaveCount(0);
  await expect(pane.getByRole("heading", { name: "hotel.jpg" })).toBeAttached();
  await expect(pass).not.toHaveAttribute("aria-current", "true");
  expect(errors).toEqual([]);
});

import { expect, test } from "@playwright/test";

test("a file dragged onto a folder in navigation moves there, and Ctrl+Z brings it back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");

  const tree = page.getByRole("tree", { name: "Places" });
  await tree.getByRole("treeitem", { name: "Pictures" }).click();
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("treeitem", { name: "Trips 2" }).click();

  const grid = page.getByRole("main");
  const hotel = grid.getByRole("button", { name: "hotel.jpg" });
  const people = tree.getByRole("treeitem", { name: "People" });
  const from = await hotel.boundingBox();
  const to = await people.boundingBox();
  if (!from || !to) throw new Error("the tile or the row is not on screen");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.getByText("Move 1 file to People")).toBeVisible();
  await page.mouse.up();

  await expect(page.getByText("Moved hotel.jpg to People.")).toBeVisible();
  await expect(hotel).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(page.getByText("hotel.jpg is back in Trips.")).toBeVisible();
  await expect(hotel).toBeVisible();
  expect(errors).toEqual([]);
});

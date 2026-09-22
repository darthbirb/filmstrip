import { expect, test } from "@playwright/test";

test("in full screen the wheel zooms, the figure sits in the area's corner, and a drag pans", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");
  await page.getByRole("button", { name: "cover.jpg" }).click();
  const pane = page.getByRole("complementary", { name: "Pane" });
  await pane.getByRole("button", { name: "Full screen" }).click();
  const area = pane.getByRole("group", { name: "Zoom" });
  await expect(area).toBeVisible();
  await page.waitForTimeout(300);

  const box = await area.boundingBox();
  if (!box) throw new Error("the pane is not showing a picture that can zoom");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let notch = 0; notch < 6; notch++) await page.mouse.wheel(0, -100);

  // The figure is a tile-inset inside the media area's bottom-left, never the picture's own corner.
  const plate = pane.getByRole("button", { name: /^Fit, from \d+%$/ });
  await expect(plate).toBeVisible();
  const at = await plate.boundingBox();
  const inset = await page.evaluate(
    () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.5,
  );
  expect(at?.x).toBeCloseTo(box.x + inset, 0);
  expect((at?.y ?? 0) + (at?.height ?? 0)).toBeCloseTo(box.y + box.height - inset, 0);

  const picture = pane.getByRole("img", { name: "cover.jpg" });
  const before = await picture.boundingBox();
  await expect(area).toHaveCSS("cursor", "grab");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  const after = await picture.boundingBox();
  expect((after?.x ?? 0) - (before?.x ?? 0)).toBeCloseTo(80, 0);
  expect((after?.y ?? 0) - (before?.y ?? 0)).toBeCloseTo(30, 0);

  await plate.click();
  await expect(plate).toHaveCount(0);
});

import { expect, test } from "@playwright/test";

test("Escape during a drag on the volume puts it away, and the next hover over the mute raises it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto("/");
  // The mock draws no video, so a real clip plays as felucca.mp4.
  await page.evaluate(async () => {
    const path: string = "/src/dev/media.ts";
    const media = await import(/* @vite-ignore */ path);
    media.serveFiles({ "felucca.mp4": await media.clip(640, 360, 600) });
  });
  await page.getByRole("combobox", { name: "Search" }).fill("felucca");
  await page.getByRole("combobox", { name: "Search" }).press("Enter");
  await page.getByRole("main").getByRole("button", { name: "felucca.mp4" }).click();

  const plate = page.getByRole("toolbar", { name: "Playback" });
  const mute = plate.getByRole("button", { name: "Mute" });
  const level = plate.getByRole("slider", { name: "Volume" });
  await mute.hover();
  await expect(level).toBeVisible();

  const box = await level.boundingBox();
  if (!box) throw new Error("the volume is not showing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4, { steps: 4 });
  await page.keyboard.press("Escape");
  await expect(level).toHaveCount(0);
  await page.mouse.up();

  await plate.getByRole("button", { name: "Play" }).hover();
  await expect(level).toHaveCount(0);

  await mute.hover();
  await expect(level).toBeVisible();

  // The press Escape ended holds nothing up.
  await plate.getByRole("button", { name: "Play" }).hover();
  await expect(level).toHaveCount(0);
});

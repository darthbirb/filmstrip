import { expect, test } from "@playwright/test";

/** With no sources, navigation draws its doorway: a button whose label is the widest thing it holds. */
test("navigation stops at what it holds rather than cutting into a button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?no-sources");
  const nav = page.getByRole("navigation", { name: "Navigation" });
  const add = nav.getByRole("button", { name: "Add a folder…" });
  await expect(add).toBeVisible();

  // Home on the splitter asks for the narrowest navigation the tokens allow, which is narrower
  // than the doorway needs; the panel is expected to stop at the doorway instead.
  await page.getByRole("separator", { name: "Resize navigation" }).focus();
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);

  const narrow = await nav.evaluate((panel) => {
    const face = panel.querySelector("div") as HTMLElement;
    const button = [...panel.querySelectorAll("button")].find((control) =>
      control.textContent?.includes("Add a folder"),
    ) as HTMLElement;
    const label = button.querySelector(".truncate") as HTMLElement;
    return {
      panel: panel.getBoundingClientRect().width,
      needed: face.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
      cut: label.scrollWidth - label.clientWidth,
    };
  });

  // Nothing of what it holds is clipped, the label is whole, and it sits on one line.
  expect(narrow.panel).toBeGreaterThanOrEqual(narrow.needed);
  expect(narrow.cut).toBeLessThanOrEqual(0);
  expect(narrow.height).toBeLessThan(40);
});

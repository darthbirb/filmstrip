import type { ComponentType } from "react";
import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { FRAMES, type Regions } from ".";

const CANDIDATES = Object.entries(FRAMES);
const REGIONS: Regions = {
  nav: <p>nav content</p>,
  toolbar: <p>toolbar content</p>,
  grid: <p>grid content</p>,
  pane: <p>pane content</p>,
};

function renderFrame(Frame: ComponentType<Regions>) {
  return render(
    <div className="flex h-dvh flex-col">
      <Frame {...REGIONS} />
    </div>,
  );
}

afterEach(() => {
  document.documentElement.style.fontSize = "";
});

test.each(CANDIDATES)("%s: a wide window docks navigation, grid and pane", async (_, Frame) => {
  await page.viewport(1600, 900);
  const screen = await renderFrame(Frame);
  await expect.element(screen.getByRole("navigation", { name: "Navigation" })).toBeVisible();
  await expect.element(screen.getByRole("complementary", { name: "Pane" })).toBeVisible();
  await expect.element(screen.getByText("grid content")).toBeVisible();
  expect(screen.getByRole("button", { name: "Show pane" }).elements()).toHaveLength(0);
});

test.each(CANDIDATES)(
  "%s: the pane folds first as room runs out, then navigation",
  async (_, Frame) => {
    await page.viewport(640, 480);
    const screen = await renderFrame(Frame);
    await expect.element(screen.getByRole("navigation", { name: "Navigation" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Pane" }).elements()).toHaveLength(0);

    document.documentElement.style.fontSize = "24px";
    await expect
      .poll(() => screen.getByRole("navigation", { name: "Navigation" }).elements().length)
      .toBe(0);
  },
);

test.each(CANDIDATES)(
  "%s: a folded panel opens over the grid, and Escape puts it away",
  async (_, Frame) => {
    await page.viewport(640, 480);
    const screen = await renderFrame(Frame);
    await screen.getByRole("button", { name: "Show pane" }).click();
    await expect.element(screen.getByText("pane content")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => screen.getByText("pane content").elements().length).toBe(0);
  },
);

test.each(CANDIDATES)(
  "%s: a panel can be hidden while it fits, and shown again",
  async (_, Frame) => {
    await page.viewport(1600, 900);
    const screen = await renderFrame(Frame);
    await screen.getByRole("button", { name: "Hide navigation" }).click();
    expect(screen.getByRole("navigation", { name: "Navigation" }).elements()).toHaveLength(0);

    await screen.getByRole("button", { name: "Show navigation" }).click();
    await expect.element(screen.getByRole("navigation", { name: "Navigation" })).toBeVisible();
  },
);

test.each(CANDIDATES)("%s: nothing overflows at any width or text size", async (_, Frame) => {
  const screen = await renderFrame(Frame);
  const frame = screen.container.firstElementChild as HTMLElement;
  for (const width of [640, 1024, 1600]) {
    for (const size of ["16px", "24px"]) {
      await page.viewport(width, 700);
      document.documentElement.style.fontSize = size;
      await expect.poll(() => frame.scrollWidth - frame.clientWidth).toBe(0);
    }
  }
});

test("scrollers use thin scrollbars in the token colours", async () => {
  const screen = await renderFrame(FRAMES.columns);
  const scroller = screen.getByText("grid content").element().parentElement as HTMLElement;
  expect(getComputedStyle(scroller).scrollbarWidth).toBe("thin");
});

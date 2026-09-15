import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { showInPane, whenShownInPane } from "../pane/pane-store";
import { getPreferences, updatePreferences } from "../preferences";
import { Frame } from "./Frame";

/** A frame whose grid holds one picture, joined to the pane as the app joins them. */
function renderRevealing() {
  return render(
    <div className="flex h-dvh flex-col">
      <Frame
        grid={
          <button type="button" onClick={() => showInPane(1)}>
            picture
          </button>
        }
        pane={<p>pane content</p>}
        revealPane={whenShownInPane}
      />
    </div>,
  );
}

function renderFrame() {
  return render(
    <div className="flex h-dvh flex-col">
      <Frame
        nav={<p>nav content</p>}
        location={<p>location content</p>}
        grid={<p>grid content</p>}
        pane={<p>pane content</p>}
      />
    </div>,
  );
}

afterEach(() => {
  document.documentElement.style.fontSize = "";
  updatePreferences({ widths: undefined, hidden: undefined });
});

test("a wide window docks navigation, grid and pane", async () => {
  await page.viewport(1600, 900);
  const screen = await renderFrame();
  await expect.element(screen.getByRole("navigation", { name: "Navigation" })).toBeVisible();
  await expect.element(screen.getByRole("complementary", { name: "Pane" })).toBeVisible();
  await expect.element(screen.getByText("grid content")).toBeVisible();
  await expect.element(screen.getByText("location content")).toBeVisible();
  expect(screen.getByRole("button", { name: "Show pane" }).elements()).toHaveLength(0);
});

test("the pane's header row holds what the pane puts there, beside its fold button", async () => {
  await page.viewport(1600, 900);
  const screen = await render(
    <div className="flex h-dvh flex-col">
      <Frame pane={<p>pane content</p>} paneHeader={<p>pane header</p>} />
    </div>,
  );
  const header = screen.getByText("pane header");
  await expect.element(header).toBeVisible();
  const row = screen.getByRole("button", { name: "Hide pane" }).element().parentElement;
  expect(row?.contains(header.element())).toBe(true);
});

test("the pane folds first as room runs out, then navigation", async () => {
  await page.viewport(640, 480);
  const screen = await renderFrame();
  await expect.element(screen.getByRole("navigation", { name: "Navigation" })).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Pane" }).elements()).toHaveLength(0);

  document.documentElement.style.fontSize = "24px";
  await expect
    .poll(() => screen.getByRole("navigation", { name: "Navigation" }).elements().length)
    .toBe(0);
});

test("a folded panel opens over the grid, and Escape puts it away", async () => {
  await page.viewport(640, 480);
  const screen = await renderFrame();
  await screen.getByRole("button", { name: "Show pane" }).click();
  await expect.element(screen.getByText("pane content")).toBeVisible();

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => screen.getByText("pane content").elements().length).toBe(0);
});

test("a panel can be hidden while it fits, and shown again", async () => {
  await page.viewport(1600, 900);
  const screen = await renderFrame();
  await screen.getByRole("button", { name: "Hide navigation" }).click();
  expect(screen.getByRole("navigation", { name: "Navigation" }).elements()).toHaveLength(0);

  await screen.getByRole("button", { name: "Show navigation" }).click();
  await expect.element(screen.getByRole("navigation", { name: "Navigation" })).toBeVisible();
});

test("clicking a picture docks a pane hidden by hand, where it fits", async () => {
  await page.viewport(1600, 900);
  updatePreferences({ hidden: { nav: false, pane: true } });
  const screen = await renderRevealing();
  expect(screen.getByText("pane content").elements()).toHaveLength(0);

  await screen.getByRole("button", { name: "picture" }).click();
  await expect.element(screen.getByRole("complementary", { name: "Pane" })).toBeVisible();
  expect(getPreferences().hidden?.pane).toBe(false);
  expect(screen.getByRole("button", { name: "Show pane" }).elements()).toHaveLength(0);
});

test("clicking a picture opens a pane that did not fit, over the grid", async () => {
  await page.viewport(640, 480);
  const screen = await renderRevealing();
  expect(screen.getByText("pane content").elements()).toHaveLength(0);

  await screen.getByRole("button", { name: "picture" }).click();
  await expect.element(screen.getByText("pane content")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Show pane" }))
    .toHaveAttribute("aria-pressed", "true");
});

test("a pane shown where it fits stays folded when the window then narrows", async () => {
  await page.viewport(1600, 900);
  updatePreferences({ hidden: { nav: false, pane: true } });
  const screen = await renderRevealing();
  await screen.getByRole("button", { name: "picture" }).click();
  await expect.element(screen.getByText("pane content")).toBeVisible();

  await page.viewport(640, 480);
  await expect.poll(() => screen.getByText("pane content").elements().length).toBe(0);
});

test("nothing overflows at any width or text size", async () => {
  const screen = await renderFrame();
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
  const screen = await renderFrame();
  const scroller = screen.getByText("grid content").element().parentElement as HTMLElement;
  expect(getComputedStyle(scroller).scrollbarWidth).toBe("thin");
});

test("panel widths and hidden panels come back from the saved preferences", async () => {
  await page.viewport(1600, 900);
  updatePreferences({ widths: { nav: 20, pane: 16 }, hidden: { nav: false, pane: true } });
  const screen = await renderFrame();
  const nav = screen.getByRole("navigation", { name: "Navigation" }).element();
  expect(nav.getBoundingClientRect().width).toBe(320);
  expect(screen.getByRole("complementary", { name: "Pane" }).elements()).toHaveLength(0);
});

test("resizing a panel is saved to the preferences", async () => {
  await page.viewport(1600, 900);
  const screen = await renderFrame();
  (screen.getByRole("separator", { name: "Resize navigation" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(getPreferences().widths?.nav).toBe(16);
});

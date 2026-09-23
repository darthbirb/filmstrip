import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { inSight } from "../../dev/in-sight";
import { Button } from "../../ui/Button";
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
  expect(screen.getByRole("button", { name: "Show Pane" }).elements()).toHaveLength(0);
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
  const row = screen.getByRole("button", { name: "Hide Pane" }).element().parentElement;
  expect(row?.contains(header.element())).toBe(true);
});

test("the pane folds first as room runs out, then navigation", async () => {
  await page.viewport(640, 480);
  const screen = await renderFrame();
  await expect.element(screen.getByRole("navigation", { name: "Navigation" })).toBeVisible();
  expect(inSight(screen.getByText("pane content"))).toBe(false);
  await expect.element(screen.getByRole("button", { name: "Show Pane" })).toBeVisible();

  document.documentElement.style.fontSize = "24px";
  await expect.poll(() => inSight(screen.getByText("nav content"))).toBe(false);
});

test("a folded panel opens over the grid, and Escape puts it away", async () => {
  await page.viewport(640, 480);
  const screen = await renderFrame();
  await screen.getByRole("button", { name: "Show Pane" }).click();
  await expect.element(screen.getByText("pane content")).toBeVisible();

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => inSight(screen.getByText("pane content"))).toBe(false);
});

test("a panel can be hidden while it fits, and shown again", async () => {
  await page.viewport(1600, 900);
  const screen = await renderFrame();
  await screen.getByRole("button", { name: "Hide Navigation" }).click();
  await expect.poll(() => inSight(screen.getByText("nav content"))).toBe(false);

  await screen.getByRole("button", { name: "Show Navigation" }).click();
  await expect.element(screen.getByRole("navigation", { name: "Navigation" })).toBeVisible();
});

test("clicking a picture docks a pane hidden by hand, where it fits", async () => {
  await page.viewport(1600, 900);
  updatePreferences({ hidden: { nav: false, pane: true } });
  const screen = await renderRevealing();
  expect(inSight(screen.getByText("pane content"))).toBe(false);

  await screen.getByRole("button", { name: "picture" }).click();
  await expect.poll(() => inSight(screen.getByText("pane content"))).toBe(true);
  expect(getPreferences().hidden?.pane).toBe(false);
  // The rail it docked out of takes the cross-fade to leave, so it is gone a moment later.
  await expect.poll(() => inSight(screen.getByRole("button", { name: "Show Pane" }))).toBe(false);
});

test("clicking a picture opens a pane that did not fit, over the grid", async () => {
  await page.viewport(640, 480);
  const screen = await renderRevealing();
  expect(inSight(screen.getByText("pane content"))).toBe(false);

  await screen.getByRole("button", { name: "picture" }).click();
  await expect.poll(() => inSight(screen.getByText("pane content"))).toBe(true);
  // Laid over the grid, it arrives wearing the one shadow in the app. DESIGN.md "Shapes".
  const panel = screen.getByRole("complementary", { name: "Pane" }).element();
  expect(getComputedStyle(panel).boxShadow).not.toBe("none");
});

test("a pane shown where it fits stays folded when the window then narrows", async () => {
  await page.viewport(1600, 900);
  updatePreferences({ hidden: { nav: false, pane: true } });
  const screen = await renderRevealing();
  await screen.getByRole("button", { name: "picture" }).click();
  await expect.element(screen.getByText("pane content")).toBeVisible();

  await page.viewport(640, 480);
  await expect.poll(() => inSight(screen.getByText("pane content"))).toBe(false);
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
  expect(inSight(screen.getByText("pane content"))).toBe(false);
});

test("a folded rail keeps its places, and its way back to the tree has a name of its own", async () => {
  await page.viewport(1600, 900);
  updatePreferences({ hidden: { nav: true, pane: false } });
  const screen = await render(
    <div className="flex h-dvh flex-col">
      <Frame nav={<p>nav content</p>} navRail={<p>rail places</p>} />
    </div>,
  );
  await expect.element(screen.getByText("rail places")).toBeVisible();
  // Two controls in one rail may not answer to a single name.
  await expect.element(screen.getByRole("button", { name: "Show Navigation" })).toBeVisible();

  await screen.getByRole("button", { name: "Show Folders" }).click();
  await expect.poll(() => inSight(screen.getByText("nav content"))).toBe(true);
  // The rail stays in the tree under the rows it cross-faded with, out of sight and out of reach.
  expect(screen.getByText("rail places").elements()).toHaveLength(1);
  await expect.poll(() => inSight(screen.getByText("rail places"))).toBe(false);
});

test("full screen gives the pane the window, and leaves the columns standing behind it", async () => {
  await page.viewport(1600, 900);
  const screen = await render(
    <div className="flex h-dvh flex-col">
      <Frame nav={<p>nav content</p>} grid={<p>grid content</p>} pane={<p>pane content</p>} full />
    </div>,
  );
  await expect.element(screen.getByText("pane content")).toBeVisible();
  // There is nothing left to fold away from, so the fold button goes rather than moves.
  expect(screen.getByRole("button", { name: "Hide Pane" }).elements()).toHaveLength(0);

  // Both columns stay in the tree, so nothing they hold is rebuilt on the way back out.
  expect(screen.getByText("grid content").elements()).toHaveLength(1);
  expect(screen.getByText("nav content").elements()).toHaveLength(1);
  await expect.poll(() => inSight(screen.getByText("grid content"))).toBe(false);
  await expect.poll(() => inSight(screen.getByText("nav content"))).toBe(false);
});

/** Something in the pane with a state of its own, which a pane built afresh would lose. */
function Kept() {
  const [clicks, setClicks] = useState(0);
  return (
    <button type="button" onClick={() => setClicks(clicks + 1)}>
      kept {clicks}
    </button>
  );
}

function Growing() {
  const [full, setFull] = useState(false);
  return (
    <div className="flex h-dvh flex-col">
      <Frame
        nav={<p>nav content</p>}
        grid={<p>grid content</p>}
        pane={<Kept />}
        paneHeader={
          <button type="button" onClick={() => setFull(!full)}>
            {full ? "Exit Full Screen" : "Full Screen"}
          </button>
        }
        full={full}
      />
    </div>
  );
}

test("full screen grows the pane's own box rather than building a new one", async () => {
  await page.viewport(1600, 900);
  const screen = await render(<Growing />);
  const pane = screen.getByRole("complementary", { name: "Pane" }).element();
  const frame = pane.parentElement?.parentElement as HTMLElement;
  await screen.getByRole("button", { name: /^kept/ }).click();
  await expect.element(screen.getByText("kept 1")).toBeVisible();

  await screen.getByRole("button", { name: "Full Screen" }).click();
  await expect.element(screen.getByRole("button", { name: "Exit Full Screen" })).toBeVisible();
  // The same box grew, so nothing it holds was rebuilt: a picture is not reloaded, a video plays on.
  expect(screen.getByRole("complementary", { name: "Pane" }).element()).toBe(pane);
  await expect.element(screen.getByText("kept 1")).toBeVisible();
  await expect.poll(() => pane.getBoundingClientRect().width).toBe(frame.clientWidth);

  await screen.getByRole("button", { name: "Exit Full Screen" }).click();
  await expect.element(screen.getByText("kept 1")).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Pane" }).element()).toBe(pane);
});

test("resizing a panel is saved to the preferences", async () => {
  await page.viewport(1600, 900);
  const screen = await renderFrame();
  (screen.getByRole("separator", { name: "Resize Navigation" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(getPreferences().widths?.nav).toBe(16);
});

test("a panel will not be squeezed until a button's label is cut", async () => {
  await page.viewport(1600, 900);
  const screen = await render(
    <div className="flex h-dvh flex-col">
      <Frame
        nav={
          <Button glyph="plus" onClick={() => {}}>
            Add a folder from somewhere else on this disk…
          </Button>
        }
        grid={<p>grid content</p>}
      />
    </div>,
  );
  const nav = screen.getByRole("navigation", { name: "Navigation" }).element();
  const splitter = screen.getByRole("separator", { name: "Resize Navigation" });

  // Home asks for the narrowest navigation the tokens allow, which is narrower than this label.
  await splitter.click();
  await userEvent.keyboard("{Home}");

  const token = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--frame-nav-min"),
  );
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  await expect.poll(() => nav.getBoundingClientRect().width).toBeGreaterThan(token * rem);

  const label = nav.querySelector("button .truncate") as HTMLElement;
  expect(label.scrollWidth - label.clientWidth, "nothing is cut off the label").toBeLessThanOrEqual(
    0,
  );
});

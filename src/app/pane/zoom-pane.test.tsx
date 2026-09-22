import { useState } from "react";
import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { folderItems } from "../../ipc/commands";
import { Pane } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { showInPane } from "./pane-store";
import { fitScale, NOTCH_IN } from "./zoom";

// Against the dev mock's library: Cairo holds pyramid.jpg, sphinx.jpg and felucca.mp4.

async function inCairo(name: string) {
  const item = (await folderItems(6)).find((row) => row.diskName === name);
  if (!item) throw new Error(`the mock has no ${name} in Cairo`);
  return item;
}

/** The pane at a width the test can change, as a splitter would. */
function Harness() {
  const [width, setWidth] = useState(400);
  return (
    <PaneDetailProvider>
      <button type="button" onClick={() => setWidth(900)}>
        widen
      </button>
      <aside
        aria-label="Pane"
        style={{ display: "flex", flexDirection: "column", width, height: 600 }}
      >
        <Pane />
      </aside>
    </PaneDetailProvider>
  );
}

beforeEach(async () => {
  showInPane(null);
  await page.viewport(1200, 800);
});

/** The pane showing a picture, once its original is in and it can zoom. */
async function showing(name: string) {
  showInPane((await inCairo(name)).id);
  const screen = await render(<Harness />);
  const area = screen.getByRole("group", { name: "Zoom" });
  await expect.element(area).toBeVisible();
  return { screen, area: area.element() as HTMLElement };
}

/** One notch of the wheel over a point in the area, up to zoom in. */
function wheel(area: HTMLElement, deltaY: number, at?: { x: number; y: number }) {
  const box = area.getBoundingClientRect();
  const x = at?.x ?? box.left + box.width / 2;
  const y = at?.y ?? box.top + box.height / 2;
  area.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX: x, clientY: y, bubbles: true }));
}

/** The figure the plate states, or null at fit, where there is no plate. */
function figure(area: HTMLElement) {
  const plate = area.querySelector<HTMLButtonElement>("button[aria-label^='Fit']");
  return plate ? Number.parseInt(plate.textContent ?? "", 10) : null;
}

function fitOf(area: HTMLElement) {
  const picture = area.querySelector("img[alt]:not([alt=''])") as HTMLImageElement;
  const own = { width: picture.naturalWidth, height: picture.naturalHeight };
  return fitScale({ width: area.clientWidth, height: area.clientHeight }, own);
}

test("at fit nothing is on the picture; one notch in brings the figure, starting from fit", async () => {
  const { area } = await showing("pyramid.jpg");
  expect(figure(area)).toBeNull();

  wheel(area, -100);
  await expect.poll(() => figure(area)).toBe(Math.round(fitOf(area) * NOTCH_IN * 100));
  // Clipped by the media area's own corner, never running to the pane's edge.
  expect(getComputedStyle(area).overflow).toBe("hidden");
  expect(getComputedStyle(area).borderRadius).toBe("10px");
});

test("the point under the pointer stays under it while the wheel turns", async () => {
  const { area } = await showing("pyramid.jpg");
  const picture = area.querySelector("img[alt]:not([alt=''])") as HTMLImageElement;
  const box = area.getBoundingClientRect();
  const at = { x: box.left + box.width * 0.3, y: box.top + box.height * 0.4 };
  const before = picture.getBoundingClientRect();
  const fraction = {
    x: (at.x - before.left) / before.width,
    y: (at.y - before.top) / before.height,
  };

  for (let notch = 0; notch < 4; notch++) wheel(area, -100, at);
  await expect.poll(() => figure(area)).not.toBeNull();
  const after = picture.getBoundingClientRect();
  expect(after.left + fraction.x * after.width).toBeCloseTo(at.x, 0);
  expect(after.top + fraction.y * after.height).toBeCloseTo(at.y, 0);
});

test("double-click and the plate both go back to fit", async () => {
  const { screen, area } = await showing("pyramid.jpg");
  wheel(area, -100);
  await expect.poll(() => figure(area)).not.toBeNull();
  await userEvent.dblClick(area);
  await expect.poll(() => figure(area)).toBeNull();

  wheel(area, -100);
  await screen.getByRole("button", { name: /^Fit, from \d+%$/ }).click();
  await expect.poll(() => figure(area)).toBeNull();
});

test("with the picture focused, plus and minus zoom, 0 fits, and the arrows pan once there is room", async () => {
  const { area } = await showing("pyramid.jpg");
  area.focus();
  await userEvent.keyboard("+");
  await expect.poll(() => figure(area)).toBe(Math.round(fitOf(area) * NOTCH_IN * 100));
  await userEvent.keyboard("0");
  await expect.poll(() => figure(area)).toBeNull();

  for (let notch = 0; notch < 8; notch++) await userEvent.keyboard("+");
  const picture = area.querySelector("img[alt]:not([alt=''])") as HTMLImageElement;
  const left = picture.getBoundingClientRect().left;
  await userEvent.keyboard("{ArrowLeft}");
  // A tenth of the view, and the picture moves the way the arrow points to show more of that side.
  await expect
    .poll(() => picture.getBoundingClientRect().left - left)
    .toBeCloseTo(area.clientWidth / 10, 0);
});

test("the pointer offers a drag only once the picture runs past the area", async () => {
  const { area } = await showing("pyramid.jpg");
  expect(getComputedStyle(area).cursor).not.toBe("grab");
  for (let notch = 0; notch < 8; notch++) wheel(area, -100);
  await expect.poll(() => getComputedStyle(area).cursor).toBe("grab");
});

test("resizing keeps the zoom as a multiple of fit, so the figure follows the new fit", async () => {
  const { screen, area } = await showing("pyramid.jpg");
  for (let notch = 0; notch < 3; notch++) wheel(area, -100);
  await expect.poll(() => figure(area)).not.toBeNull();
  const multiple = (figure(area) ?? 0) / (fitOf(area) * 100);

  await screen.getByRole("button", { name: "widen" }).click();
  await expect.poll(() => (figure(area) ?? 0) / (fitOf(area) * 100)).toBeCloseTo(multiple, 1);
});

test("the next item starts at fit", async () => {
  const { area } = await showing("pyramid.jpg");
  wheel(area, -100);
  await expect.poll(() => figure(area)).not.toBeNull();
  showInPane((await inCairo("sphinx.jpg")).id);
  await expect.poll(() => document.querySelector("button[aria-label^='Fit']")).toBeNull();
});

test("a video does not zoom", async () => {
  showInPane((await inCairo("felucca.mp4")).id);
  const screen = await render(<Harness />);
  await expect.element(screen.container.querySelector("video") as HTMLVideoElement).toBeVisible();
  expect(screen.getByRole("group", { name: "Zoom" }).elements()).toHaveLength(0);
});

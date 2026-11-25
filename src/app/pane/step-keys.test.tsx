import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { folderItems } from "../../ipc/commands";
import { Frame } from "../frame/Frame";
import { Grid } from "../grid/Grid";
import { type Place, setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { getFullScreen, setFullScreen, useFullScreen } from "./full-screen";
import { Pane, PaneHeader } from "./Pane";
import { PaneDetailProvider } from "./pane-detail";
import { getPaneItem, showInPane, whenShownInPane } from "./pane-store";

// Against the dev mock's library: Cairo holds felucca.mp4, pyramid.jpg and sphinx.jpg.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

/** The grid and the pane as the frame holds them: in full screen the grid is out of reach. */
function Harness() {
  const full = useFullScreen();
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex", width: 1100, height: 700 }}>
        <div inert={full} style={{ width: 700, height: 700 }}>
          <Grid mode="justified" />
        </div>
        <aside aria-label="Pane" style={{ display: "flex", flexDirection: "column", width: 400 }}>
          <PaneHeader />
          <div style={{ flex: 1, minHeight: 0 }}>
            <Pane />
          </div>
        </aside>
      </div>
    </PaneDetailProvider>
  );
}

/** The app's own frame, whose folded or hidden pane is out of reach until it is shown. */
function Framed() {
  const full = useFullScreen();
  return (
    <PaneDetailProvider>
      <div className="flex h-dvh flex-col">
        <Frame
          grid={<Grid mode="justified" />}
          pane={<Pane />}
          paneHeader={<PaneHeader />}
          revealPane={whenShownInPane}
          full={full}
        />
      </div>
    </PaneDetailProvider>
  );
}

afterEach(() => {
  updatePreferences({ widths: undefined, hidden: undefined });
});

beforeEach(async () => {
  setFullScreen(false);
  showInPane(null);
  setPlace(CAIRO);
  updatePreferences({ details: undefined });
  await page.viewport(1200, 800);
});

async function idOf(name: string) {
  const item = (await folderItems(6)).find((row) => row.diskName === name);
  if (!item) throw new Error(`the mock has no ${name} in Cairo`);
  return item.id;
}

/** The harness with the pane showing one of Cairo's files, and the names along its strip in order. */
async function showing(name: string) {
  const screen = await render(<Harness />);
  showInPane(await idOf(name), CAIRO);
  const frames = () => [
    ...document.querySelectorAll<HTMLElement>("[aria-label='Filmstrip'] [role=option]"),
  ];
  await expect.poll(() => frames().length).toBe(3);
  const names = frames()
    .sort(
      (a, b) => Number(a.getAttribute("aria-posinset")) - Number(b.getAttribute("aria-posinset")),
    )
    .map((frame) => frame.getAttribute("aria-label") ?? "");
  return { screen, names };
}

/** The name of the file the pane shows. */
function shown() {
  return document.querySelector("aside h2")?.textContent ?? null;
}

/** The file whose picture holds the focus, or null when the focus is anywhere else. */
function focused() {
  const area = document.activeElement;
  if (area?.parentElement?.tagName !== "FIGURE") return null;
  return shown();
}

test("a double-click into full screen puts the focus on the picture, and the keys step from there", async () => {
  const { screen, names } = await showing("sphinx.jpg");
  const [first, second, last] = names as [string, string, string];
  // Another tile than the one shown, so its picture is not yet drawn when full screen opens.
  const opened = first === "sphinx.jpg" ? last : first;

  await screen.getByRole("button", { name: opened, exact: true }).first().dblClick();
  expect(getFullScreen()).toBe(true);
  await expect.poll(focused).toBe(opened);

  await userEvent.keyboard("{Home}");
  await expect.poll(focused).toBe(first);
  await userEvent.keyboard("{ArrowRight}");
  await expect.poll(shown).toBe(second);
  await expect.poll(focused).toBe(second);
  await userEvent.keyboard("{End}");
  await expect.poll(focused).toBe(last);
  await userEvent.keyboard("{ArrowLeft}");
  await expect.poll(focused).toBe(second);
});

test("the Full Screen button puts the focus on the picture, and the arrows step at once", async () => {
  const { screen, names } = await showing("pyramid.jpg");
  const at = names.indexOf("pyramid.jpg");
  const [key, next] =
    at < names.length - 1 ? ["{ArrowRight}", names[at + 1]] : ["{ArrowLeft}", names[at - 1]];

  await screen.getByRole("button", { name: "Full Screen" }).click();
  await expect.poll(focused).toBe("pyramid.jpg");
  await userEvent.keyboard(key);
  await expect.poll(focused).toBe(next);
});

test("docked, the arrows step from a click on the picture or a button in the pane, never from the grid", async () => {
  const { screen, names } = await showing("pyramid.jpg");
  const at = names.indexOf("pyramid.jpg");
  const area = screen.getByRole("group", { name: "Zoom" });
  await expect.element(area).toBeVisible();

  await area.click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.poll(focused).toBe(names[at + 1] ?? "pyramid.jpg");
  showInPane(await idOf("pyramid.jpg"), CAIRO);
  await expect.poll(shown).toBe("pyramid.jpg");

  // The bar goes with the file it acts on, so a step from the pane's buttons hands the focus on.
  (screen.getByRole("button", { name: "Full Screen" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.poll(focused).toBe(names[at - 1] ?? "pyramid.jpg");

  const tile = screen.getByRole("button", { name: "sphinx.jpg", exact: true }).first();
  (tile.element() as HTMLElement).focus();
  const before = getPaneItem();
  await userEvent.keyboard("{End}");
  await userEvent.keyboard("{ArrowLeft}");
  expect(getPaneItem()).toBe(before);
});

test("a zoomed picture keeps the arrows for panning, and steps once it is back at fit", async () => {
  const { screen, names } = await showing("pyramid.jpg");
  const at = names.indexOf("pyramid.jpg");
  const [key, next] =
    at < names.length - 1 ? ["{ArrowRight}", names[at + 1]] : ["{ArrowLeft}", names[at - 1]];
  const area = screen.getByRole("group", { name: "Zoom" });
  await expect.element(area).toBeVisible();
  await area.click();

  const pyramid = await idOf("pyramid.jpg");

  // Below fit there is no room to pan, and the arrow is still the picture's.
  await userEvent.keyboard("-");
  await expect.element(screen.getByRole("button", { name: /^Fit, from/ })).toBeVisible();
  await userEvent.keyboard(key);
  expect(getPaneItem()).toBe(pyramid);
  for (let notch = 0; notch < 10; notch++) await userEvent.keyboard("+");
  await userEvent.keyboard(key);
  expect(getPaneItem()).toBe(pyramid);

  await userEvent.keyboard("0");
  await expect
    .poll(() => screen.getByRole("button", { name: /^Fit, from/ }).elements())
    .toHaveLength(0);
  await userEvent.keyboard(key);
  await expect.poll(focused).toBe(next);
});

test("a field in the pane keeps the arrows", async () => {
  const { screen } = await showing("pyramid.jpg");
  await expect.poll(shown).toBe("pyramid.jpg");
  await screen.getByRole("button", { name: /MB$/ }).click();
  await screen.getByRole("button", { name: "pyramid.jpg", exact: true }).last().click();
  const field = screen.getByRole("textbox", { name: "Rename pyramid.jpg" });
  await expect.element(field).toHaveFocus();

  await userEvent.keyboard("{ArrowRight}{ArrowLeft}{Home}{End}");
  expect(getPaneItem()).toBe(await idOf("pyramid.jpg"));
  await expect.element(field).toHaveFocus();
});

test("with the pane hidden, Full Screen from the shown file's menu puts the focus on its picture", async () => {
  await page.viewport(1600, 900);
  const screen = await render(<Framed />);
  const tile = screen.getByRole("button", { name: "pyramid.jpg", exact: true }).first();
  await tile.click();
  await expect.poll(shown).toBe("pyramid.jpg");
  await screen.getByRole("button", { name: "Hide Pane" }).click();
  await expect.element(screen.getByRole("button", { name: "Show Pane" })).toBeVisible();

  await tile.click({ button: "right" });
  await screen.getByRole("menuitem", { name: "Full Screen" }).click();
  expect(getFullScreen()).toBe(true);
  await expect.poll(focused).toBe("pyramid.jpg");
});

test("Full Screen from another file's menu puts the focus on that file's picture once it is drawn", async () => {
  const { screen } = await showing("sphinx.jpg");
  await expect.poll(shown).toBe("sphinx.jpg");

  await screen
    .getByRole("button", { name: "pyramid.jpg", exact: true })
    .first()
    .click({ button: "right" });
  await screen.getByRole("menuitem", { name: "Full Screen" }).click();
  expect(getFullScreen()).toBe(true);
  await expect.poll(focused).toBe("pyramid.jpg");
});

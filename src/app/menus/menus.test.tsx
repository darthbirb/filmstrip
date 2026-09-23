import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { FolderNode } from "../../ipc/bindings/FolderNode";
import { folderItems } from "../../ipc/commands";
import { Grid } from "../grid/Grid";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { setFullScreen } from "../pane/full-screen";
import { Pane } from "../pane/Pane";
import { PaneDetailProvider } from "../pane/pane-detail";
import { getPaneItem, showInPane } from "../pane/pane-store";
import { type Place, setPlace } from "../place";
import { Settings } from "../settings/Settings";
import { closeSettings, useSettingsRequest } from "../settings/settings-store";

// Against the dev mock: Pictures holds People and Trips › Cairo, whose three items are
// pyramid.jpg, sphinx.jpg and felucca.mp4; Archive cannot be reached.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

type Internals = { invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown> };
const internals = () =>
  (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;

/** Every command the app sends while `work` runs, answered as the dev mock answers it. */
async function recording(
  work: (calls: [string, unknown][]) => Promise<void>,
  answer?: (cmd: string, args: unknown) => unknown,
) {
  const real = internals().invoke;
  const calls: [string, unknown][] = [];
  internals().invoke = (cmd, args, options) => {
    calls.push([cmd, args]);
    const answered = answer?.(cmd, args);
    return answered === undefined ? real(cmd, args, options) : Promise.resolve(answered);
  };
  try {
    await work(calls);
  } finally {
    internals().invoke = real;
  }
}

function SettingsFromStore() {
  const request = useSettingsRequest();
  return (
    <Settings
      open={request !== null}
      onClose={closeSettings}
      section={request?.section}
      asking={request?.asking}
    />
  );
}

function Harness() {
  return (
    <PaneDetailProvider>
      <div style={{ display: "flex", width: 1300, height: 760 }}>
        <nav style={{ width: 260 }}>
          <Navigation />
        </nav>
        <div style={{ width: 640, height: 760 }}>
          <Grid mode="justified" />
        </div>
        <aside aria-label="Pane" style={{ display: "flex", flexDirection: "column", width: 400 }}>
          <Pane />
        </aside>
      </div>
      <SettingsFromStore />
    </PaneDetailProvider>
  );
}

const labels = (menu: ReturnType<Awaited<ReturnType<typeof render>>["getByRole"]>) =>
  menu
    .getByRole("menuitem")
    .elements()
    .map((row) => row.querySelector(".truncate")?.textContent);

async function menuOn(
  screen: Awaited<ReturnType<typeof render>>,
  target: ReturnType<Awaited<ReturnType<typeof render>>["getByRole"]>,
  name: string,
) {
  await target.click({ button: "right" });
  const menu = screen.getByRole("menu", { name });
  await expect.element(menu).toBeVisible();
  return menu;
}

async function inCairo(name: string) {
  const item = (await folderItems(6)).find((row) => row.diskName === name);
  if (!item) throw new Error(`the mock has no ${name} in Cairo`);
  return item;
}

beforeEach(async () => {
  closeSettings();
  setFullScreen(false);
  showInPane(null);
  setPlace(CAIRO);
  resetIndex();
  await loadIndex();
  await page.viewport(1400, 800);
});

test("a tile's menu is the bar's verbs in the bar's order, and opening it leaves the pane alone", async () => {
  const screen = await render(<Harness />);
  const menu = await menuOn(
    screen,
    screen.getByRole("button", { name: "pyramid.jpg" }),
    "pyramid.jpg",
  );
  expect(labels(menu)).toEqual([
    "Full Screen",
    "Favourite",
    "Show in Explorer",
    "Copy",
    "Open with Default App",
  ]);
  expect(menu.element().querySelectorAll("hr")).toHaveLength(1);
  expect(getPaneItem()).toBeNull();
});

test("Full screen from a tile shows it there, and the picture's own menu then leads with the way out", async () => {
  const screen = await render(<Harness />);
  const pyramid = await inCairo("pyramid.jpg");
  const menu = await menuOn(
    screen,
    screen.getByRole("button", { name: "pyramid.jpg" }),
    "pyramid.jpg",
  );
  await menu.getByRole("menuitem", { name: "Full Screen" }).click();
  expect(getPaneItem()).toBe(pyramid.id);

  const picture = screen.getByRole("complementary", { name: "Pane" }).getByRole("group", {
    name: "Zoom",
  });
  await expect.element(picture).toBeVisible();
  const own = await menuOn(screen, picture, "pyramid.jpg");
  expect(labels(own)[0]).toBe("Exit Full Screen");
  await own.getByRole("menuitem", { name: "Exit Full Screen" }).click();
  await expect.element(own).not.toBeInTheDocument();
});

test("Escape in a menu over full screen closes the menu and nothing else", async () => {
  showInPane((await inCairo("pyramid.jpg")).id, CAIRO);
  setFullScreen(true);
  const screen = await render(<Harness />);
  const picture = screen.getByRole("complementary", { name: "Pane" }).getByRole("group", {
    name: "Zoom",
  });
  await expect.element(picture).toBeVisible();
  await menuOn(screen, picture, "pyramid.jpg");
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
  const { getFullScreen } = await import("../pane/full-screen");
  expect(getFullScreen()).toBe(true);
});

test("a filmstrip frame is a tile, and gets the tile's menu", async () => {
  showInPane((await inCairo("pyramid.jpg")).id, CAIRO);
  const screen = await render(<Harness />);
  const frame = screen.getByRole("listbox", { name: "Filmstrip" }).getByRole("option", {
    name: "sphinx.jpg",
  });
  const menu = await menuOn(screen, frame, "sphinx.jpg");
  expect(labels(menu)).toEqual([
    "Full Screen",
    "Favourite",
    "Show in Explorer",
    "Copy",
    "Open with Default App",
  ]);
});

test("Favourite from a tile's menu shows on the pane's bar at once", async () => {
  const sphinx = await inCairo("sphinx.jpg");
  showInPane(sphinx.id, CAIRO);
  const screen = await render(<Harness />);
  const bar = screen.getByRole("toolbar", { name: "Actions" });
  await expect.element(bar.getByRole("button", { name: "Favourite" })).toBeVisible();
  const menu = await menuOn(
    screen,
    screen.getByRole("button", { name: "sphinx.jpg" }),
    "sphinx.jpg",
  );
  await menu.getByRole("menuitem", { name: "Favourite" }).click();
  await expect.element(bar.getByRole("button", { name: "Remove Favourite" })).toBeVisible();
  const again = await menuOn(
    screen,
    screen.getByRole("button", { name: "sphinx.jpg" }),
    "sphinx.jpg",
  );
  expect(labels(again)[1]).toBe("Remove Favourite");
});

test("a folder's row reveals and reads again; a source's adds Rename, then the Sources section", async () => {
  const screen = await render(<Harness />);
  const source = screen.getByRole("treeitem", { name: "Pictures" });
  const sourceMenu = await menuOn(screen, source, "Pictures");
  expect(labels(sourceMenu)).toEqual([
    "Show in Explorer",
    "Rename",
    "Refresh",
    "Manage Sources",
    "Remove Source",
  ]);
  await userEvent.keyboard("{Escape}");

  await source.click();
  await userEvent.keyboard("{ArrowRight}");
  const trips = screen.getByRole("treeitem", { name: "Trips 2" });
  const folderMenu = await menuOn(screen, trips, "Trips");
  expect(labels(folderMenu)).toEqual(["Show in Explorer", "Refresh"]);
  expect(folderMenu.element().querySelectorAll("hr")).toHaveLength(0);
});

test("the verbs reach the commands they name, for the folder they were opened on", async () => {
  const screen = await render(<Harness />);
  await recording(async (calls) => {
    const source = screen.getByRole("treeitem", { name: "Pictures" });
    let menu = await menuOn(screen, source, "Pictures");
    await menu.getByRole("menuitem", { name: "Refresh" }).click();
    await source.click();
    await userEvent.keyboard("{ArrowRight}");
    const trips = screen.getByRole("treeitem", { name: "Trips 2" });
    menu = await menuOn(screen, trips, "Trips");
    await menu.getByRole("menuitem", { name: "Show in Explorer" }).click();
    menu = await menuOn(screen, trips, "Trips");
    await menu.getByRole("menuitem", { name: "Refresh" }).click();
    const sent = calls.filter(([cmd]) => ["read_folder_again", "reveal_folder"].includes(cmd));
    expect(sent).toEqual([
      ["read_folder_again", { folderId: 1 }],
      ["reveal_folder", { folderId: 4 }],
      ["read_folder_again", { folderId: 4 }],
    ]);
  });
});

test("an offline source keeps what needs no drive, and an offline folder opens nothing", async () => {
  const old: FolderNode = { id: 99, title: "Old", childCount: 0, itemCount: 0 };
  await recording(
    async () => {
      resetIndex();
      await loadIndex();
      const screen = await render(<Harness />);
      const archive = screen.getByRole("treeitem", { name: "Archive offline" });
      const menu = await menuOn(screen, archive, "Archive");
      expect(labels(menu)).toEqual(["Rename", "Manage Sources", "Remove Source"]);
      await userEvent.keyboard("{Escape}");

      await archive.click();
      await userEvent.keyboard("{ArrowRight}");
      const folder = screen.getByRole("treeitem", { name: "Old" });
      await folder.click({ button: "right" });
      await new Promise((settle) => setTimeout(settle, 100));
      expect(screen.getByRole("menu").elements()).toHaveLength(0);
    },
    (cmd, args) =>
      cmd === "folder_children" && (args as { folderId: number }).folderId === 3
        ? [old]
        : undefined,
  );
});

test("Manage Sources opens Settings on Sources, and Remove Source opens it asking", async () => {
  const screen = await render(<Harness />);
  const source = screen.getByRole("treeitem", { name: "Pictures" });
  let menu = await menuOn(screen, source, "Pictures");
  await menu.getByRole("menuitem", { name: "Manage Sources" }).click();
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  await expect.element(dialog.getByRole("region", { name: "Sources" })).toBeVisible();
  expect(dialog.getByRole("button", { name: "Cancel" }).elements()).toHaveLength(0);
  closeSettings();

  menu = await menuOn(screen, source, "Pictures");
  await menu.getByRole("menuitem", { name: "Remove Source" }).click();
  await expect.element(dialog.getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(dialog.getByRole("button", { name: "Remove Source" }).elements()).toHaveLength(1);
});

test("Rename makes the source's row a field: Escape and a blank keep the name, Enter and leaving rename", async () => {
  const screen = await render(<Harness />);
  const source = screen.getByRole("treeitem", { name: "Pictures" });
  const field = screen.getByRole("textbox", { name: "Rename Pictures" });
  const rename = async () => {
    const menu = await menuOn(screen, source, "Pictures");
    await menu.getByRole("menuitem", { name: "Rename" }).click();
    await expect.element(field).toHaveFocus();
  };
  await recording(async (calls) => {
    const renames = () => calls.filter(([cmd]) => cmd === "rename_source");

    await rename();
    const input = field.element() as HTMLInputElement;
    // The whole name is chosen, so typing replaces it.
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Pictures".length]);
    await userEvent.keyboard("Holidays{Escape}");
    await expect.element(field).not.toBeInTheDocument();
    await expect.element(source).toHaveFocus();

    await rename();
    await userEvent.keyboard("{Backspace}{Enter}");
    await expect.element(field).not.toBeInTheDocument();
    expect(renames()).toHaveLength(0);

    await rename();
    await userEvent.keyboard("Holidays{Enter}");
    await expect.element(field).not.toBeInTheDocument();
    expect(renames()).toEqual([["rename_source", { id: 1, title: "Holidays" }]]);

    await rename();
    await userEvent.keyboard("Summer");
    await screen.getByRole("button", { name: "pyramid.jpg" }).click();
    await expect.element(field).not.toBeInTheDocument();
    expect(renames().at(-1)).toEqual(["rename_source", { id: 1, title: "Summer" }]);
  });
});

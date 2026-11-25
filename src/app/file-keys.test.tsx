import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { failCommand, onDriveWithoutBin, resetBin } from "../dev/mock";
import { recording } from "../dev/recording";
import { folderItems, undoLast } from "../ipc/commands";
import { Grid } from "./grid/Grid";
import { clearChecked } from "./grid/selection";
import { useFileKeys } from "./keys";
import { Foot } from "./navigation/Foot";
import { getNews, setNews } from "./navigation/foot-slot";
import { loadIndex, resetIndex } from "./navigation/index-store";
import { NoBinQuestion, resetNoBinQuestion } from "./pane/no-bin";
import { addToPane, getPaneItem, showInPane } from "./pane/pane-store";
import { type Place, setPlace } from "./place";
import { showReport } from "./undo/report-store";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg, in that order.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

beforeEach(async () => {
  while (await undoLast()) {}
  resetBin();
  resetNoBinQuestion();
  setNews(null);
  showReport(null);
  resetIndex();
  await loadIndex();
  setPlace(CAIRO);
  clearChecked();
  showInPane(null);
});

afterEach(() => {
  for (const stray of document.querySelectorAll("[data-stray]")) stray.remove();
});

function Keys() {
  useFileKeys();
  return null;
}

async function renderIt() {
  await page.viewport(1200, 800);
  const screen = await render(
    <>
      <Keys />
      <div data-testid="grid" style={{ width: 900, height: 500 }}>
        <Grid mode="uniform" />
      </div>
      <div data-testid="foot" style={{ width: 640 }}>
        <NoBinQuestion />
        <Foot />
      </div>
    </>,
  );
  const grid = screen.getByTestId("grid");
  await expect.element(grid.getByRole("button", { name: "sphinx.jpg" })).toBeVisible();
  return { grid, foot: screen.getByTestId("foot") };
}

type Regions = Awaited<ReturnType<typeof renderIt>>;

const idOf = async (name: string) =>
  (await folderItems(6)).find((row) => row.diskName === name)?.id ?? -1;
const sent = (calls: [string, unknown][], cmd: string) => calls.find(([one]) => one === cmd)?.[1];

async function check({ grid }: Regions, name: string) {
  await userEvent.click(grid.getByRole("checkbox", { name: `Select ${name}` }));
}

const never = (calls: [string, unknown][], ...cmds: string[]) =>
  expect(calls.map(([cmd]) => cmd).filter((cmd) => cmds.includes(cmd))).toEqual([]);

/** A text field outside the app's own, holding the focus. */
function aField() {
  const field = document.createElement("input");
  field.dataset.stray = "";
  document.body.append(field);
  field.focus();
}

test("Delete sends what is checked to the bin with no question, and Undo answers it", async () => {
  const at = await renderIt();
  const ids = [await idOf("felucca.mp4"), await idOf("sphinx.jpg")];
  await check(at, "felucca.mp4");
  await check(at, "sphinx.jpg");
  await recording(async (calls) => {
    await userEvent.keyboard("{Delete}");
    await expect.poll(() => sent(calls, "trash_items")).toEqual({ itemIds: ids });
  });
  await expect.element(at.foot.getByRole("button", { name: "Undo" })).toBeVisible();
  expect((await folderItems(6)).map((row) => row.diskName)).toEqual(["pyramid.jpg"]);
});

test("with nothing checked Delete sends the pane's file, and the pane moves on", async () => {
  const at = await renderIt();
  const [pyramid, sphinx] = [await idOf("pyramid.jpg"), await idOf("sphinx.jpg")];
  showInPane(pyramid, CAIRO);
  await userEvent.keyboard("{Delete}");
  await expect.element(at.foot.getByText("Deleted pyramid.jpg.")).toBeVisible();
  await expect.poll(getPaneItem).toBe(sphinx);
});

test("Delete on a drive with no Recycle Bin asks, and Delete in the question asks no more", async () => {
  const at = await renderIt();
  const pyramid = await idOf("pyramid.jpg");
  onDriveWithoutBin([pyramid], "USB Drive (E:)");
  showInPane(pyramid, CAIRO);
  await userEvent.keyboard("{Delete}");
  const question = at.foot.getByRole("region", { name: /has no Recycle Bin/ });
  await expect.element(question).toBeVisible();
  await expect.poll(() => question.element().contains(document.activeElement)).toBe(true);
  await recording(async (calls) => {
    await userEvent.keyboard("{Delete}");
    await userEvent.keyboard("{Control>}{Shift>}C{/Shift}{/Control}");
    never(calls, "binless_items", "trash_items", "copy_item_paths");
  });
  expect(await idOf("pyramid.jpg")).toBe(pyramid);
});

test("Ctrl+C copies what is checked, and Ctrl+Shift+C its paths", async () => {
  const at = await renderIt();
  const ids = [await idOf("felucca.mp4"), await idOf("pyramid.jpg")];
  await check(at, "felucca.mp4");
  await check(at, "pyramid.jpg");
  await recording(async (calls) => {
    await userEvent.keyboard("{Control>}c{/Control}");
    await expect.poll(() => sent(calls, "copy_items")).toEqual({ itemIds: ids });
    await userEvent.keyboard("{Control>}{Shift>}C{/Shift}{/Control}");
    await expect.poll(() => sent(calls, "copy_item_paths")).toEqual({ itemIds: ids });
  });
});

test("with nothing checked Ctrl+C and Ctrl+Shift+C take the pane's file", async () => {
  await renderIt();
  const sphinx = await idOf("sphinx.jpg");
  showInPane(sphinx, CAIRO);
  await recording(async (calls) => {
    await userEvent.keyboard("{Control>}c{/Control}");
    await expect.poll(() => sent(calls, "copy_items")).toEqual({ itemIds: [sphinx] });
    await userEvent.keyboard("{Control>}{Shift>}C{/Shift}{/Control}");
    await expect.poll(() => sent(calls, "copy_item_paths")).toEqual({ itemIds: [sphinx] });
  });
});

test("a pane's file that cannot be read says so when a key acts on it", async () => {
  await renderIt();
  const scan = 3;
  expect(await idOf("scan 03.tif")).toBe(-1);
  showInPane(scan, null);
  failCommand("item_detail", { kind: "permissionDenied" });
  try {
    await recording(async (calls) => {
      await userEvent.keyboard("{Control>}c{/Control}");
      await expect
        .poll(getNews)
        .toEqual({ kind: "failed", line: "Could not copy 1 file. Windows refused access." });
      never(calls, "copy_items");
    });
  } finally {
    failCommand("item_detail", null);
  }
});

test("none of the keys acts in a text field, or over Settings", async () => {
  await renderIt();
  const sphinx = await idOf("sphinx.jpg");
  showInPane(sphinx, CAIRO);
  await recording(async (calls) => {
    aField();
    await userEvent.keyboard("{Delete}");
    await userEvent.keyboard("{Control>}c{/Control}");
    await userEvent.keyboard("{Control>}{Shift>}C{/Shift}{/Control}");
    const settings = document.createElement("dialog");
    settings.dataset.stray = "";
    document.body.append(settings);
    settings.show();
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("{Delete}");
    await userEvent.keyboard("{Control>}c{/Control}");
    settings.close();
    await userEvent.keyboard("{Control>}{Shift>}C{/Shift}{/Control}");
    await expect.poll(() => sent(calls, "copy_item_paths")).toEqual({ itemIds: [sphinx] });
    never(calls, "trash_items", "binless_items", "copy_items");
  });
});

test("with several in the pane and nothing checked the keys act on nothing", async () => {
  const at = await renderIt();
  const [pyramid, sphinx] = [await idOf("pyramid.jpg"), await idOf("sphinx.jpg")];
  showInPane(pyramid, CAIRO);
  addToPane([sphinx], CAIRO);
  await recording(async (calls) => {
    await userEvent.keyboard("{Delete}");
    await userEvent.keyboard("{Control>}c{/Control}");
    await check(at, "felucca.mp4");
    await userEvent.keyboard("{Control>}{Shift>}C{/Shift}{/Control}");
    await expect.poll(() => sent(calls, "copy_item_paths")).toBeDefined();
    never(calls, "trash_items", "binless_items", "copy_items");
  });
});

test("a trashed file is left alone by the keys, as the Trash's bar has only Restore", async () => {
  const at = await renderIt();
  const [pyramid, sphinx] = [await idOf("pyramid.jpg"), await idOf("sphinx.jpg")];
  showInPane(sphinx, CAIRO);
  await userEvent.keyboard("{Delete}");
  await expect.element(at.foot.getByText("Deleted sphinx.jpg.")).toBeVisible();
  setPlace({ kind: "trash" });
  showInPane(sphinx, { kind: "trash" });
  await recording(async (calls) => {
    await userEvent.keyboard("{Delete}");
    await userEvent.keyboard("{Control>}c{/Control}");
    showInPane(pyramid, CAIRO);
    await userEvent.keyboard("{Control>}{Shift>}C{/Shift}{/Control}");
    await expect.poll(() => sent(calls, "copy_item_paths")).toEqual({ itemIds: [pyramid] });
    never(calls, "trash_items", "binless_items", "copy_items");
  });
});

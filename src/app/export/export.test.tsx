import { emit } from "@tauri-apps/api/event";
import { beforeAll, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import type { Stayed } from "../../ipc/bindings/Stayed";
import { createFolder, folderItems, indexProgress } from "../../ipc/commands";
import { Grid } from "../grid/Grid";
import { SelectionBar } from "../grid/SelectionBar";
import { clearChecked } from "../grid/selection";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex, startIndex } from "../navigation/index-store";
import { Navigation } from "../navigation/Navigation";
import { setOpenFolders } from "../navigation/open-folders";
import { watchWork } from "../navigation/work-store";
import { type Place, setPlace } from "../place";
import { getPreferences, updatePreferences } from "../preferences";
import { ReportBanner } from "../undo/ReportBanner";
import { showReport } from "../undo/report-store";
import { ExportSheetHost } from "./ExportSheet";
import { afterExported, awayLine, openSheet, skippedNote, watchExports } from "./export";

// Against the dev mock: Pictures holds Trips, with boarding-pass.png and hotel.jpg, and Trips
// holds Cairo, with felucca.mp4, pyramid.jpg and sphinx.jpg. Its save dialog always says
// D:\Exports, and an export takes a few moments.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

beforeAll(async () => {
  await startIndex();
  await watchWork();
  await watchExports();
});

beforeEach(async () => {
  setNews(null);
  showReport(null);
  openSheet(null);
  resetIndex();
  await loadIndex();
  setPlace(CAIRO);
  clearChecked();
  updatePreferences({ exportNaming: "keep", exportDir: undefined });
});

async function renderAll() {
  await page.viewport(1200, 800);
  const screen = await render(
    <>
      <div style={{ display: "flex", width: 1200, height: 700 }}>
        <nav style={{ width: 260, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Navigation />
          </div>
          <Foot />
        </nav>
        <div style={{ display: "flex", flexDirection: "column", width: 900 }}>
          <ReportBanner />
          <div style={{ flex: 1, minHeight: 0 }}>
            <Grid mode="uniform" />
          </div>
          <SelectionBar />
        </div>
      </div>
      <ExportSheetHost />
    </>,
  );
  await expect.element(page.getByRole("button", { name: "sphinx.jpg" })).toBeVisible();
  return screen;
}

const box = (name: string) => page.getByRole("checkbox", { name: `Check ${name}` });
const bar = () => page.getByRole("toolbar", { name: "Selection" });
const sheet = (name: string) => page.getByRole("dialog", { name });
const idsIn = async (names: string[]) =>
  (await folderItems(6)).filter((row) => names.includes(row.diskName)).map((row) => row.id);

/** Exports Cairo's pyramid and sphinx from the bar, as far as the sheet. */
async function exportTwo() {
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(box("sphinx.jpg"));
  await userEvent.click(bar().getByRole("button", { name: "Export…" }).last());
  await expect.element(sheet("Export 2 Files")).toBeVisible();
}

test("Export… on the bar asks where, then how the files are named, and Export queues the zip", async () => {
  await renderAll();
  await recording(async (calls) => {
    await exportTwo();
    const shown = sheet("Export 2 Files");
    expect(calls.find(([cmd]) => cmd === "pick_export_zip")?.[1]).toEqual({
      name: "Cairo",
      dir: null,
    });
    await expect.element(shown.getByText("Pictures/Trips/Cairo/")).toBeVisible();
    await expect.element(shown.getByText("pyramid.jpg")).toBeVisible();
    await expect.element(shown.getByText("Cairo.zip")).toBeVisible();
    await expect.element(shown.getByText("Exports")).toBeVisible();
    await expect.element(shown.getByRole("button", { name: "Export" })).toHaveFocus();

    await userEvent.click(shown.getByText("From Folders"));
    await expect.element(shown.getByText(/^Cairo - \d{4}(-\d\d){5}\.jpg$/)).toBeVisible();
    await userEvent.click(shown.getByRole("button", { name: "Export" }));
    await expect.element(shown).not.toBeInTheDocument();
    expect(calls.find(([cmd]) => cmd === "start_export")?.[1]).toEqual({
      scope: { kind: "files", itemIds: await idsIn(["pyramid.jpg", "sphinx.jpg"]) },
      naming: "folders",
      path: "D:\\Exports\\Cairo.zip",
    });
  });
  expect(getPreferences()).toMatchObject({ exportNaming: "folders", exportDir: "D:\\Exports" });

  await expect.element(page.getByText("Exporting Cairo.zip…")).toBeVisible();
  await expect
    .element(page.getByTitle(/^Exporting to D:\\Exports\\Cairo\.zip · \d of 2 left$/))
    .toBeInTheDocument();
  await expect.element(page.getByText("Exported 2 files to Cairo.zip.")).toBeVisible();
  await recording(async (calls) => {
    await page.getByRole("button", { name: "Show in Explorer" }).click();
    expect(calls).toContainEqual(["reveal_path", { path: "D:\\Exports\\Cairo.zip" }]);
  });

  // The zip is there now, and Windows' Yes over it is refused before the sheet opens.
  clearChecked();
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(bar().getByRole("button", { name: "Export…" }).last());
  await expect.element(page.getByText("Filmstrip never replaces a file.")).toBeVisible();
  await expect.element(page.getByText("Cairo.zip is already in Exports.")).toBeVisible();
  await expect.element(sheet("Export 1 File")).not.toBeInTheDocument();
});

test("Escape or Cancel writes nothing and gives the focus back to Export…", async () => {
  updatePreferences({ exportDir: "D:\\Kept" });
  await renderAll();
  await recording(async (calls) => {
    await exportTwo();
    expect(calls.find(([cmd]) => cmd === "pick_export_zip")?.[1]).toEqual({
      name: "Cairo",
      dir: "D:\\Kept",
    });
    await userEvent.keyboard("{Escape}");
    await expect.element(sheet("Export 2 Files")).not.toBeInTheDocument();
    await expect.element(bar().getByRole("button", { name: "Export…" }).last()).toHaveFocus();
    await userEvent.click(bar().getByRole("button", { name: "Export…" }).last());
    await userEvent.click(sheet("Export 2 Files").getByRole("button", { name: "Cancel" }));
    await expect.element(sheet("Export 2 Files")).not.toBeInTheDocument();
    expect(calls.some(([cmd]) => cmd === "start_export")).toBe(false);
  });
  expect(getPreferences().exportNaming).toBe("keep");
});

test("Export… on a folder's row takes its branch, and the sheet hangs off the row", async () => {
  const screen = await renderAll();
  await screen.getByRole("treeitem", { name: "Pictures 1 of 6" }).click();
  await userEvent.keyboard("{ArrowRight}");
  const trips = screen.getByRole("treeitem", { name: "Trips 2 of 5" });
  await trips.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export…" }).click();
  const shown = sheet("Trips · 5 Files");
  await expect.element(shown).toBeVisible();
  await expect.element(shown.getByText("Trips/", { exact: true })).toBeVisible();
  await expect.element(shown.getByText("boarding-pass.png")).toBeVisible();
  await expect.element(shown.getByText("Trips.zip")).toBeVisible();
  const row = trips.element().getBoundingClientRect();
  const hung = shown.element().getBoundingClientRect();
  expect(Math.round(hung.left)).toBe(Math.round(row.left));
  expect(hung.top).toBeGreaterThan(row.bottom);

  await recording(async (calls) => {
    await userEvent.click(shown.getByRole("button", { name: "Export" }));
    expect(calls.find(([cmd]) => cmd === "start_export")?.[1]).toEqual({
      scope: { kind: "branch", folderId: 4 },
      naming: "keep",
      path: "D:\\Exports\\Trips.zip",
    });
  });
  await recording(async (calls) => {
    await page.getByRole("button", { name: "Cancel Export" }).click();
    expect(calls.find(([cmd]) => cmd === "cancel_export")).toBeTruthy();
  });
  await expect
    .element(page.getByText("Stopped exporting Trips.zip. Nothing was written."))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Show in Explorer" }))
    .not.toBeInTheDocument();
});

test("Export… on a folder with no files in it says so, and asks nothing", async () => {
  const screen = await renderAll();
  setOpenFolders(new Set([1]));
  await recording(async (calls) => {
    await screen.getByRole("treeitem", { name: /^People / }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Export…" }).click();
    await expect.element(page.getByText("People has no files to export.")).toBeVisible();
    expect(calls.some(([cmd]) => cmd === "pick_export_zip")).toBe(false);
  });
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("an export's line moving leaves the tree as it is", async () => {
  updatePreferences({ exportDir: "D:\\Tree" });
  const screen = await renderAll();
  setOpenFolders(new Set([1, 4]));
  const cairo = screen.getByRole("treeitem", { name: /^Cairo / });
  await expect.element(cairo).toBeVisible();
  await exportTwo();
  await userEvent.click(sheet("Export 2 Files").getByRole("button", { name: "Export" }));
  await expect.element(page.getByText("Exporting Cairo.zip…")).toBeVisible();
  await expect.element(page.getByText("Exported 2 files to Cairo.zip.")).toBeVisible();
  await expect.element(cairo).toBeVisible();
});

test("a job that ends between two of the walk's ticks reads the tree again, and leaves it open", async () => {
  const screen = await renderAll();
  const idle = await indexProgress();
  await emit("job-progress", idle);
  await loadIndex();
  setOpenFolders(new Set([1, 4]));
  const cairo = screen.getByRole("treeitem", { name: /^Cairo / });
  await expect.element(cairo).toBeVisible();

  await createFolder(4, "Lisbon");
  await emit("job-progress", { ...idle, completed: idle.completed + 1 });
  await expect.element(screen.getByRole("treeitem", { name: /^Lisbon / })).toBeVisible();
  await expect.element(cairo).toBeVisible();
});

const ARCHIVE: Stayed[] = ["page 001.tif", "page 002.tif"].map((name, at) => ({
  kind: "file",
  id: 900 + at,
  name,
  at: { kind: "folder", folderId: 7, path: ["Archive", "Scans"] },
  reason: { kind: "offline", source: "Archive" },
}));

test("files skipped as away are said before, then listed in the banner with no Retry", async () => {
  expect(awayLine(["Archive"], 4)).toBe("Archive is offline, so these 4 files cannot be exported.");
  expect(awayLine(["Archive", "Card"], 1)).toBe(
    "Archive and Card are offline, so this file cannot be exported.",
  );
  expect(
    skippedNote({
      kind: "ready",
      whole: 6,
      away: 2,
      offline: ["Archive"],
      first: { dir: "Pictures/", keep: "a.jpg", folders: "b.jpg" },
    }),
  ).toBe("2 of the 6 are on Archive, which is offline. They are skipped.");

  await renderAll();
  afterExported({
    jobId: 1,
    path: "D:\\Exports\\Search Results.zip",
    zip: "Search Results.zip",
    place: "Exports",
    dir: "D:\\Exports",
    whole: 6,
    written: 4,
    skipped: ARCHIVE,
    end: { kind: "written" },
  });
  await expect.element(page.getByText("4 of 6 files went into Search Results.zip")).toBeVisible();
  await expect.element(page.getByText("Skipped in Archive › Scans")).toBeVisible();
  await expect.element(page.getByText("Archive is offline").first()).toBeVisible();
  expect(document.body.textContent).not.toContain("Retry");
  await expect
    .element(page.getByRole("button", { name: "Show page 001.tif in Explorer" }))
    .not.toBeInTheDocument();
  await expect
    .element(
      page.getByText("Exported 4 of 6 files to Search Results.zip. The other 2 are in the banner."),
    )
    .toBeVisible();
});

test("a zip that could not be written is said in the band with its folder, and leaves no banner", async () => {
  await renderAll();
  afterExported({
    jobId: 2,
    path: "D:\\Exports\\Trips.zip",
    zip: "Trips.zip",
    place: "Exports",
    dir: "D:\\Exports",
    whole: 5,
    written: 0,
    skipped: [],
    end: { kind: "failed", reason: { kind: "diskFull" } },
  });
  await expect
    .element(page.getByText("Trips.zip could not be written. The disk is full."))
    .toBeVisible();
  await expect.element(page.getByTitle("D:\\Exports")).toBeVisible();

  afterExported({
    jobId: 3,
    path: "D:\\Exports\\Trips.zip",
    zip: "Trips.zip",
    place: "Exports",
    dir: "D:\\Exports",
    whole: 5,
    written: 0,
    skipped: [],
    end: { kind: "taken" },
  });
  await expect.element(page.getByText("Trips.zip is already in Exports.")).toBeVisible();
});

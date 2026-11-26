import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { failRedo } from "../../dev/mock";
import { folderItems, moveItems, undoLast } from "../../ipc/commands";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { ReportBanner } from "./ReportBanner";
import { showReport } from "./report-store";
import { afterAct, redo, useUndoKey } from "./undo";

// Against the dev mock: Trips (4) holds boarding-pass.png and hotel.jpg; People (5) holds nothing.

function Harness({ field = false }: { field?: boolean }) {
  useUndoKey();
  return (
    <div>
      {field && <input aria-label="Field" />}
      <ReportBanner />
      <Foot />
    </div>
  );
}

beforeEach(async () => {
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  resetIndex();
  await loadIndex();
});

async function moveTrips() {
  const ids = (await folderItems(4)).map((item) => item.id);
  const moved = await moveItems(ids, 5);
  if (moved.kind !== "done" || !moved.batch) throw new Error("the mock moved nothing");
  afterAct(moved.batch);
}

async function moveAndUndo() {
  await moveTrips();
  await userEvent.keyboard("{Control>}z{/Control}");
  await expect.poll(async () => (await folderItems(4)).length).toBe(2);
}

test("the line after an undo offers Redo, which moves the files again and offers Undo", async () => {
  const screen = await render(<Harness />);
  await moveAndUndo();
  await expect.element(screen.getByText("2 files are back in Trips.")).toBeVisible();
  const again = screen.getByRole("button", { name: "Redo", exact: true });
  await expect.element(again).toHaveAttribute("title", "Redo · Ctrl+Y");

  await again.click();
  await expect.element(screen.getByText("Moved 2 files to People.")).toBeVisible();
  expect((await folderItems(5)).length).toBe(2);
  expect(screen.getByRole("button", { name: "Redo", exact: true }).elements()).toHaveLength(0);

  await screen.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.element(screen.getByText("2 files are back in Trips.")).toBeVisible();
  expect((await folderItems(4)).length).toBe(2);
});

test("Ctrl+Y and Ctrl+Shift+Z redo, and say once when nothing is left to redo", async () => {
  const screen = await render(<Harness />);
  await moveAndUndo();
  await userEvent.keyboard("{Control>}y{/Control}");
  await expect.element(screen.getByText("Moved 2 files to People.")).toBeVisible();
  expect((await folderItems(5)).length).toBe(2);

  await userEvent.keyboard("{Control>}z{/Control}");
  await expect.poll(async () => (await folderItems(4)).length).toBe(2);
  await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
  await expect.poll(async () => (await folderItems(5)).length).toBe(2);

  await userEvent.keyboard("{Control>}y{/Control}");
  await expect.element(screen.getByText("Nothing to redo.")).toBeVisible();
  await userEvent.keyboard("{Shift}");
  await expect.poll(() => screen.getByText("Nothing to redo.").elements().length).toBe(0);
});

test("neither redo key fires in a field, nor over Settings", async () => {
  const screen = await render(<Harness field />);
  await moveAndUndo();
  await screen.getByRole("textbox", { name: "Field" }).click();
  await userEvent.keyboard("{Control>}y{/Control}");
  await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
  expect((await folderItems(4)).length).toBe(2);

  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  dialog.showModal();
  try {
    await userEvent.keyboard("{Control>}y{/Control}");
    expect((await folderItems(4)).length).toBe(2);
  } finally {
    dialog.remove();
  }
});

test("a new act drops the redo", async () => {
  const screen = await render(<Harness />);
  await moveAndUndo();
  const ids = (await folderItems(4)).map((item) => item.id);
  await moveItems(ids.slice(0, 1), 5);
  await userEvent.keyboard("{Control>}y{/Control}");
  await expect.element(screen.getByText("Nothing to redo.")).toBeVisible();
  expect((await folderItems(4)).length).toBe(1);
});

test("a failed redo says which act and why, and keeps its Redo to try again", async () => {
  const screen = await render(<Harness />);
  await moveAndUndo();
  failRedo(true);
  try {
    await screen.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .element(screen.getByText("Could not redo “Moved 2 files to People”. The disk is full."))
      .toBeVisible();
    expect((await folderItems(4)).length).toBe(2);
  } finally {
    failRedo(false);
  }

  await screen.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.element(screen.getByText("Moved 2 files to People.")).toBeVisible();
});

test("folded, a failed redo keeps the rail's Redo and its sentence comes out beside it", async () => {
  const screen = await render(<Foot rail />);
  await moveTrips();
  await undoLast();
  const failure = "Could not redo “Moved 2 files to People”. The disk is full.";
  failRedo(true);
  try {
    await redo();
    await expect.element(screen.getByText(failure)).toBeVisible();
    const again = screen.getByRole("button", { name: "Redo · Ctrl+Y", exact: true });
    await expect.element(again).toBeVisible();
    expect(again.element().getAttribute("aria-description")).toBe(failure);
  } finally {
    failRedo(false);
  }
});

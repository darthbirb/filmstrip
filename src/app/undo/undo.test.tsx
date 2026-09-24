import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import { folderItems, moveItems, undoLast } from "../../ipc/commands";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { setRefused } from "../navigation/refusal-store";
import { ReportBanner } from "./ReportBanner";
import { showReport } from "./report-store";
import { afterAct, useUndoKey } from "./undo";

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
  // Whatever an earlier test left in the mock's journal is taken back first.
  while (await undoLast()) {}
  setNews(null);
  showReport(null);
  resetIndex();
  await loadIndex();
});

async function moveTrips() {
  const ids = (await folderItems(4)).map((item) => item.id);
  const moved = await moveItems(ids, 5);
  if (!moved.batch) throw new Error("the mock moved nothing");
  afterAct(moved.batch);
}

test("an act says what it did at the foot, and Undo takes it back and says so", async () => {
  const screen = await render(<Harness />);
  await moveTrips();
  await expect.element(screen.getByText("Moved 2 files to People.")).toBeVisible();

  await screen.getByRole("button", { name: "Undo" }).click();
  await expect.element(screen.getByText("2 files are back in Trips.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Undo" }).elements()).toHaveLength(0);
  expect((await folderItems(4)).length).toBe(2);
});

test("the newest news takes the slot: a refusal replaces the line, and the line a refusal", async () => {
  const screen = await render(<Harness />);
  await moveTrips();
  setRefused({ why: "inside", clash: "Pictures", path: "C:\\Users\\ada\\Pictures\\Trips" });
  await expect.element(screen.getByText("That folder is already inside Pictures.")).toBeVisible();
  expect(screen.getByText("Moved 2 files to People.").elements()).toHaveLength(0);

  await undoLast();
  await moveTrips();
  await expect.element(screen.getByText("Moved 2 files to People.")).toBeVisible();
  expect(screen.getByText("That folder is already inside Pictures.").elements()).toHaveLength(0);
});

test("Ctrl+Z takes back the newest act, and says once when nothing is left", async () => {
  const screen = await render(<Harness />);
  await moveTrips();
  await userEvent.keyboard("{Control>}z{/Control}");
  await expect.element(screen.getByText("2 files are back in Trips.")).toBeVisible();

  await userEvent.keyboard("{Control>}z{/Control}");
  await expect.element(screen.getByText("Nothing to undo.")).toBeVisible();
  await userEvent.keyboard("{Shift}");
  await expect.poll(() => screen.getByText("Nothing to undo.").elements().length).toBe(0);
});

test("Ctrl+Z in a field is the field's own, and over Settings it does nothing", async () => {
  const screen = await render(<Harness field />);
  await moveTrips();
  await screen.getByRole("textbox", { name: "Field" }).click();
  await userEvent.keyboard("{Control>}z{/Control}");
  expect((await folderItems(4)).length).toBe(0);

  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  dialog.showModal();
  try {
    await userEvent.keyboard("{Control>}z{/Control}");
    expect((await folderItems(4)).length).toBe(0);
  } finally {
    dialog.remove();
  }
});

test("an undo that came back in part opens the banner, grouped by where each file stayed", async () => {
  const screen = await render(<Harness />);
  const at = (path: string[]) => ({ kind: "folder" as const, folderId: 1, path });
  showReport({
    sentence: "3 of 5 files are back in Trips",
    rows: [
      {
        kind: "file",
        id: 1,
        name: "IMG_0031.jpg",
        at: at(["Pictures", "Cairo"]),
        reason: { kind: "nameTaken", place: "Trips", name: "IMG_0031.jpg", folder: false },
      },
      {
        kind: "file",
        id: 2,
        name: "clip.mov",
        at: at(["Pictures", "Cairo"]),
        reason: { kind: "inUse" },
      },
    ],
    retry: () => undefined,
  });
  await expect.element(screen.getByText("3 of 5 files are back in Trips")).toBeVisible();
  await expect.element(screen.getByText("Still in Cairo")).toBeVisible();
  await expect.element(screen.getByText("Name taken in Trips")).toBeVisible();
  await expect.element(screen.getByText("Open in another app")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Hide Files" })).toBeVisible();
});

test("a folder a file kept is shown open in Explorer, with that file selected", async () => {
  const screen = await render(<Harness />);
  showReport({
    sentence: "Lisbon could not go",
    rows: [
      {
        kind: "folder",
        id: 6,
        name: "Lisbon",
        at: { kind: "folder", folderId: 4, path: ["Pictures", "Trips"] },
        reason: { kind: "holds", name: "notes.txt", more: 0 },
      },
    ],
  });
  await expect.element(screen.getByText("Holds notes.txt")).toBeVisible();
  await recording(async (calls) => {
    await screen.getByRole("button", { name: "Show Lisbon in Explorer" }).click();
    expect(calls).toContainEqual(["reveal_held", { folderId: 6 }]);
  });
});

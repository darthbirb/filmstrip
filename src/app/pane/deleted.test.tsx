import { emit } from "@tauri-apps/api/event";
import { beforeAll, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import type { Batch } from "../../ipc/bindings/Batch";
import type { Deleted } from "../../ipc/bindings/Deleted";
import type { Progress } from "../../ipc/bindings/Progress";
import { listSources } from "../../ipc/commands";
import { afterDeleted } from "../deleted";
import { deleteFolderAsking } from "../navigation/delete-folder";
import { Foot } from "../navigation/Foot";
import { getNews, setNews } from "../navigation/foot-slot";
import { watchWork } from "../navigation/work-store";
import { updatePreferences } from "../preferences";
import { getEmptying, startEmptying } from "../settings/settings-store";
import { getReport, showReport } from "../undo/report-store";
import { getPaneFolder, showFolderInPane, showInPane } from "./pane-store";

// How a delete on the queue shows at the foot and says how it ended. DECISIONS.md "Background work".

beforeAll(async () => {
  await watchWork();
});

beforeEach(() => {
  setNews(null);
  showReport(null);
});

const IDLE: Progress = {
  phase: "idle",
  pending: 0,
  running: 0,
  failed: 0,
  completed: 0,
  copies: [],
  exports: [],
  moves: [],
  deletes: [],
  walks: 0,
  walkedSource: null,
  thumbed: [],
};

test("a delete on the queue has its own line at the foot, and its dismiss cancels it", async () => {
  const screen = await render(<Foot />);
  await emit("job-progress", {
    ...IDLE,
    deletes: [
      { jobId: 9, kind: "files", name: "", done: 30, whole: 120 },
      { jobId: 10, kind: "folder", name: "Lisbon", done: 1, whole: 4 },
    ],
  });
  await expect.element(screen.getByText("Deleting 120 files…")).toBeVisible();
  await expect.element(screen.getByText("Deleting Lisbon…")).toBeVisible();
  await expect
    .element(screen.getByTitle("Deleting 120 files · 90 of 120 left", { exact: true }))
    .toBeInTheDocument();
  await expect.element(screen.getByText("25%", { exact: true }).first()).toBeVisible();

  await recording(async (calls) => {
    await screen.getByRole("button", { name: "Cancel Delete" }).first().click();
    expect(calls).toContainEqual(["cancel_delete", { jobId: 10 }]);
  });
  await emit("job-progress", IDLE);
  await expect.poll(() => document.body.textContent).not.toContain("Deleting");
});

test("emptying the Trash has its line at the foot with no Cancel, and its description says why", async () => {
  const screen = await render(<Foot />);
  await emit("job-progress", {
    ...IDLE,
    deletes: [{ jobId: 11, kind: "empty", name: "", done: 3, whole: 12 }],
  });
  await expect.element(screen.getByText("Emptying the Trash…")).toBeVisible();
  await expect
    .element(screen.getByTitle("Emptying the Trash · 9 of 12 left", { exact: true }))
    .toHaveAttribute("aria-description", "It cannot be cancelled: what has gone has gone.");
  expect(screen.getByRole("button", { name: "Cancel Delete" }).query()).toBeNull();
  await emit("job-progress", IDLE);
});

const DELETED_40: Batch = {
  batchId: "d1",
  act: { kind: "delete", from: null, one: null },
  files: 40,
  folders: 0,
};

const files: Extract<Deleted, { kind: "files" }> = {
  kind: "files",
  jobId: 9,
  batch: DELETED_40,
  report: { trashed: 40, refused: [] },
  whole: 120,
  cancelled: false,
  stopped: null,
};

test("a delete cancelled partway says what went, against what it was asked, with its Undo", async () => {
  await afterDeleted({ ...files, cancelled: true });
  expect(getNews()).toEqual({
    kind: "done",
    line: "Moved 40 of 120 files to the Recycle Bin.",
    batchId: "d1",
  });

  setNews(null);
  await afterDeleted({
    ...files,
    batch: null,
    report: { trashed: 0, refused: [] },
    cancelled: true,
  });
  expect(getNews(), "nothing went, so nothing is said").toBeNull();
});

test("a delete that ended says what went as one inside the command does", async () => {
  await afterDeleted({ ...files, whole: 40 });
  expect(getNews()).toEqual({
    kind: "done",
    line: "Moved 40 files to the Recycle Bin.",
    batchId: "d1",
  });
  expect(getReport()).toBeNull();
});

test("a delete that stopped on its own says why, with what went and its Undo", async () => {
  const stopped = { kind: "diskFull" } as const;
  await afterDeleted({ ...files, stopped });
  expect(getNews()).toMatchObject({
    kind: "done",
    line: "Moved 40 of 120 files to the Recycle Bin. The disk is full.",
  });
});

const folder: Extract<Deleted, { kind: "folder" }> = {
  kind: "folder",
  jobId: 10,
  folderId: 6,
  name: "Cairo",
  contents: { kind: "trash" },
  batch: {
    batchId: "f1",
    act: { kind: "deleteFolder", name: "Cairo", parent: "Trips", into: null },
    files: 12,
    folders: 1,
  },
  report: { deleted: true, refused: [], outright: 0 },
  whole: 12,
  cancelled: false,
  stopped: null,
};

test("a folder deleted on the queue says so as one inside the command does", async () => {
  await afterDeleted(folder);
  expect(getNews()).toEqual({
    kind: "done",
    line: "Deleted Cairo and its 12 files.",
    batchId: "f1",
  });
});

test("a folder's delete cancelled partway says what went and that the folder stays", async () => {
  const batch: Batch = {
    batchId: "f2",
    act: { kind: "delete", from: null, one: null },
    files: 5,
    folders: 0,
  };
  await afterDeleted({
    ...folder,
    batch,
    report: { deleted: false, refused: [], outright: 0 },
    cancelled: true,
  });
  expect(getNews()).toEqual({
    kind: "done",
    line: "Moved 5 of Cairo’s 12 files to the Recycle Bin. Cairo stays.",
    batchId: "f2",
  });
});

test("a folder put in the pane while the folder above it is deleted leaves the pane once it has gone", async () => {
  showInPane(null);
  updatePreferences({ deleteInto: 2 });
  await recording(
    async () => {
      await deleteFolderAsking({ id: 4, name: "Trips" }, await listSources());
    },
    (cmd) => (cmd === "delete_folder" ? { kind: "started", jobId: 77 } : undefined),
  );
  showFolderInPane(6, 1);
  await afterDeleted({ ...folder, jobId: 77, folderId: 4, name: "Trips" });
  expect(getPaneFolder()).toBeNull();
  updatePreferences({ deleteInto: undefined });
});

test("emptying the Trash on the queue ends the head's count and says what went", async () => {
  startEmptying(3);
  await afterDeleted({
    kind: "empty",
    jobId: 11,
    emptied: { deleted: 3, bytes: 7_200_000, gone: 0, kept: 0, stayed: [] },
    cancelled: false,
    stopped: null,
  });
  expect(getEmptying()).toBeNull();
  expect(getNews()).toMatchObject({ kind: "said" });
});

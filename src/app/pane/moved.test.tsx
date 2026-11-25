import { emit } from "@tauri-apps/api/event";
import { beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import type { Batch } from "../../ipc/bindings/Batch";
import type { Progress } from "../../ipc/bindings/Progress";
import type { Stayed } from "../../ipc/bindings/Stayed";
import { Foot } from "../navigation/Foot";
import { getNews, setNews } from "../navigation/foot-slot";
import { watchWork } from "../navigation/work-store";
import { getReport, showReport } from "../undo/report-store";
import { afterMoved } from "./move-picker";

// Against the dev mock: Pictures holds People (5) and Trips (4), Trips holds Cairo (6).

beforeAll(async () => {
  await watchWork();
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
  walks: 0,
  walkedSource: null,
  thumbed: [],
};

test("a move between drives has its own line at the foot, and its dismiss cancels it", async () => {
  const screen = await render(<Foot />);
  const progress = {
    ...IDLE,
    moves: [{ jobId: 8, folderId: 5, to: "People", done: 30, whole: 120 }],
  };
  await emit("job-progress", progress);
  await expect.element(screen.getByText("Moving to People…")).toBeVisible();
  await expect.element(screen.getByText("25%")).toBeVisible();
  await expect.element(screen.getByTitle("Moving to People · 90 of 120 left")).toBeInTheDocument();

  await recording(async (calls) => {
    await screen.getByRole("button", { name: "Cancel Move" }).click();
    expect(calls).toContainEqual(["cancel_move", { jobId: 8 }]);
  });
  await emit("job-progress", IDLE);
  await expect.poll(() => document.body.textContent).not.toContain("Moving to People");
});

const MOVED_ONE: Batch = {
  batchId: "m1",
  act: { kind: "move", from: "Cairo", to: "People", one: null },
  files: 1,
  folders: 0,
};

const ended = {
  jobId: 8,
  folderId: 5,
  to: "People",
  whole: 3,
  refused: [],
  cancelled: false,
  stopped: null,
};

test("a move cancelled partway says what went, against what it carried, with its Undo", async () => {
  setNews(null);
  await afterMoved({ ...ended, batch: MOVED_ONE, cancelled: true });
  expect(getNews()).toEqual({
    kind: "done",
    line: "Moved 1 of 3 files to People.",
    batchId: "m1",
  });

  setNews(null);
  await afterMoved({ ...ended, batch: null, cancelled: true });
  expect(getNews(), "nothing went, so nothing is said").toBeNull();
});

test("a move that left files where they were lists them, and Retry moves them again", async () => {
  setNews(null);
  showReport(null);
  const taken: Stayed = {
    kind: "file",
    id: 31,
    name: "tram.jpg",
    at: { kind: "folder", folderId: 6, path: ["Pictures", "Trips", "Cairo"] },
    reason: { kind: "nameTaken", place: "People", name: "tram.jpg", folder: false },
  };
  await afterMoved({ ...ended, whole: 2, batch: MOVED_ONE, refused: [taken] });
  expect(getReport()?.sentence).toBe("1 of 2 files moved to People");
  expect(getNews()).toMatchObject({
    kind: "done",
    line: "Moved 1 of 2 files to People. The other 1 is in the banner.",
  });

  await recording(async (calls) => {
    getReport()?.retry?.();
    await expect
      .poll(() => calls.find(([cmd]) => cmd === "move_items")?.[1])
      .toEqual({ itemIds: [31], folderId: 5 });
  });
  showReport(null);
  setNews(null);
});

test("a move that stopped on its own says why, with what went and its Undo", async () => {
  setNews(null);
  const stopped = { kind: "folderGone", name: "People" } as const;
  await afterMoved({ ...ended, batch: null, stopped });
  expect(getNews()).toEqual({
    kind: "keyRefused",
    line: "The 3 files could not go to People.",
    detail: "People is gone.",
  });

  await afterMoved({ ...ended, batch: MOVED_ONE, stopped });
  expect(getNews()).toEqual({
    kind: "done",
    line: "Moved 1 of 3 files to People. People is gone.",
    batchId: "m1",
  });
  setNews(null);
});

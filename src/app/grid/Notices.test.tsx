import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import type { Failure } from "../../ipc/bindings/Failure";
import type { Progress } from "../../ipc/bindings/Progress";
import { resetWork, watchWork } from "../navigation/work-store";
import { Notices } from "./Notices";

const FAILURES: Failure[] = [
  {
    jobId: 1,
    kind: "thumb",
    path: ["Trips", "Cairo", "_DSC4411.ARW"],
    itemId: 11,
    folderId: 6,
    reason: { kind: "unsupported" },
    attempts: 3,
  },
  {
    jobId: 2,
    kind: "thumb",
    path: ["People", "scan 03.tif"],
    itemId: 12,
    folderId: 5,
    reason: { kind: "permissionDenied" },
    attempts: 3,
  },
];

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

let served: Failure[] = FAILURES;
let retried = 0;
let revealed: string[] = [];

/** Two failures found, and whatever the retry leaves behind. */
async function reportFailures(failed: number) {
  await emit("job-progress", { ...IDLE, failed, completed: 5 });
}

beforeEach(async () => {
  served = FAILURES;
  retried = 0;
  revealed = [];
  mockIPC(
    (cmd, payload) => {
      if (cmd === "index_progress") return IDLE;
      if (cmd === "reveal_item" || cmd === "reveal_folder") {
        revealed.push(`${cmd} ${JSON.stringify(payload)}`);
        return null;
      }
      if (cmd === "index_failures") return served;
      if (cmd === "retry_failed_jobs") {
        retried += 1;
        served = [];
        return served.length;
      }
      return undefined;
    },
    { shouldMockEvents: true },
  );
  resetWork();
  await watchWork();
});

test("nothing is said while nothing has failed", async () => {
  const screen = await render(<Notices />);
  expect(screen.getByText(/could not be indexed/).elements()).toHaveLength(0);
});

test("the failures are counted, listed in place, and can be tried again", async () => {
  const screen = await render(<Notices />);
  await reportFailures(2);
  await expect.element(screen.getByText("2 files could not be indexed")).toBeVisible();
  // The list is not a dialog: it stays closed until asked for.
  expect(screen.getByText("Unsupported format").elements()).toHaveLength(0);

  await screen.getByRole("button", { name: "Show Files" }).click();
  await expect.element(screen.getByText("Trips\\Cairo\\_DSC4411.ARW")).toBeVisible();
  await expect.element(screen.getByText("Unsupported format")).toBeVisible();

  await screen.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => retried).toBe(1);
  await expect.poll(() => screen.getByText(/could not be indexed/).elements().length).toBe(0);
});

test("a dismissed banner stays away until something else fails", async () => {
  const screen = await render(<Notices />);
  await reportFailures(2);
  await expect.element(screen.getByText("2 files could not be indexed")).toBeVisible();

  await screen.getByRole("button", { name: "Dismiss" }).click();
  await expect.poll(() => screen.getByText(/could not be indexed/).elements().length).toBe(0);

  served = [
    ...FAILURES,
    {
      jobId: 3,
      kind: "thumb",
      path: ["clip.mov"],
      itemId: 13,
      folderId: 1,
      reason: { kind: "noFfmpeg" },
      attempts: 1,
    },
  ];
  await reportFailures(3);
  await expect.element(screen.getByText("3 files could not be indexed")).toBeVisible();
});

test("each failure is placed inside its source, worded as the undo banner words it, and can be looked at", async () => {
  served = [
    ...FAILURES,
    {
      jobId: 3,
      kind: "index_folder",
      path: ["People"],
      itemId: null,
      folderId: 5,
      reason: { kind: "busy" },
      attempts: 2,
    },
    {
      jobId: 4,
      kind: "index_folder",
      path: ["Pictures"],
      itemId: null,
      folderId: 1,
      reason: { kind: "busy" },
      attempts: 2,
    },
    {
      jobId: 5,
      kind: "index",
      path: [],
      itemId: null,
      folderId: null,
      reason: { kind: "other" },
      attempts: 2,
    },
    {
      jobId: 6,
      kind: "index_folder",
      path: [],
      itemId: null,
      folderId: 2,
      reason: { kind: "other" },
      attempts: 1,
    },
  ];
  const screen = await render(<Notices />);
  await reportFailures(6);
  await screen.getByRole("button", { name: "Show Files" }).click();

  await expect.element(screen.getByText("Reason", { exact: true })).toBeVisible();
  expect(screen.getByText("Error", { exact: true }).elements()).toHaveLength(0);
  await expect.element(screen.getByText("People\\scan 03.tif")).toBeVisible();
  await expect.element(screen.getByText("Permission denied")).toBeVisible();
  await expect.element(screen.getByText("Pictures", { exact: true })).toBeVisible();
  expect(screen.getByText("The index is busy").elements()).toHaveLength(2);
  expect(screen.getByText("The library").elements()).toHaveLength(2);
  expect(screen.getByText("Something went wrong").elements()).toHaveLength(2);

  await screen.getByRole("button", { name: "Show _DSC4411.ARW in Explorer" }).click();
  await screen.getByRole("button", { name: "Show People in Explorer" }).click();
  await screen.getByRole("button", { name: "Show Pictures in Explorer" }).click();
  await expect
    .poll(() => revealed)
    .toEqual([
      'reveal_item {"itemId":11}',
      'reveal_folder {"folderId":5}',
      'reveal_folder {"folderId":1}',
    ]);
  expect(screen.getByRole("button", { name: /in Explorer$/ }).elements()).toHaveLength(4);
  expect(screen.getByRole("button", { name: /^Show {2}in Explorer$/ }).elements()).toHaveLength(0);
});

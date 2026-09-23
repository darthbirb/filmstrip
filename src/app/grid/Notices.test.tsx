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
    name: "Trips\\Cairo\\_DSC4411.ARW",
    error: "Unsupported raw",
    attempts: 3,
  },
  { jobId: 2, kind: "thumb", name: "People\\scan 03.tif", error: "Permission denied", attempts: 3 },
];

const IDLE: Progress = { phase: "idle", pending: 0, running: 0, failed: 0, completed: 0 };

let served: Failure[] = FAILURES;
let retried = 0;

/** Two failures found, and whatever the retry leaves behind. */
async function reportFailures(failed: number) {
  await emit("job-progress", { ...IDLE, failed, completed: 5 });
}

beforeEach(async () => {
  served = FAILURES;
  retried = 0;
  mockIPC(
    (cmd) => {
      if (cmd === "index_progress") return IDLE;
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
  expect(screen.getByText("Unsupported raw").elements()).toHaveLength(0);

  await screen.getByRole("button", { name: "Show Files" }).click();
  await expect.element(screen.getByText("Trips\\Cairo\\_DSC4411.ARW")).toBeVisible();
  await expect.element(screen.getByText("Unsupported raw")).toBeVisible();

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
    { jobId: 3, kind: "thumb", name: "clip.mov", error: "ffmpeg not found", attempts: 1 },
  ];
  await reportFailures(3);
  await expect.element(screen.getByText("3 files could not be indexed")).toBeVisible();
});

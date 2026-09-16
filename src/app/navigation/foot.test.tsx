import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import type { Progress } from "../../ipc/bindings/Progress";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { getPlace, setPlace } from "../place";
import { Foot } from "./Foot";
import { loadIndex, resetIndex } from "./index-store";
import { Rail } from "./Rail";
import { resetWork, watchWork } from "./work-store";

const SOURCES: SourceSummary[] = [
  {
    id: 1,
    root: "D:\\Pictures",
    title: "Pictures",
    kind: "library",
    addedAt: 0,
    rootFolderId: 1,
    reachable: true,
    itemCount: 41_236,
    totalBytes: 0,
  },
  {
    id: 2,
    root: "D:\\Incoming",
    title: "Incoming",
    kind: "sorting",
    addedAt: 0,
    rootFolderId: 2,
    reachable: true,
    itemCount: 3,
    totalBytes: 0,
  },
];

const IDLE: Progress = { phase: "idle", pending: 0, running: 0, failed: 0, completed: 0 };

beforeEach(async () => {
  mockIPC(
    (cmd) => {
      if (cmd === "list_sources") return SOURCES;
      if (cmd === "index_progress") return IDLE;
      if (cmd === "index_failures") return [];
      return undefined;
    },
    { shouldMockEvents: true },
  );
  resetIndex();
  resetWork();
  setPlace(null);
  await loadIndex();
  await watchWork();
});

test("the panel's baseline counts what the library holds, grouped as Windows groups it", async () => {
  const screen = await render(<Foot />);
  await expect.element(screen.getByText("41,239 items · 2 sources")).toBeVisible();
});

test("a walk shows above the baseline while it runs, and leaves when it ends", async () => {
  const screen = await render(<Foot />);
  const line = () => screen.getByText(/^Indexing/);
  expect(line().elements()).toHaveLength(0);

  await emit("job-progress", {
    phase: "working",
    pending: 4120,
    running: 0,
    failed: 0,
    completed: 6880,
  });
  await expect.element(line()).toBeVisible();
  await expect.element(screen.getByText("Indexing 4,120…")).toBeVisible();
  await expect.element(screen.getByText("63%")).toBeVisible();
  // The baseline never moves out from under it.
  await expect.element(screen.getByText("41,239 items · 2 sources")).toBeVisible();

  await emit("job-progress", IDLE);
  await expect.poll(() => line().elements().length).toBe(0);
});

test("the folded rail keeps the app's own places, each carrying its count", async () => {
  const screen = await render(<Rail />);
  // A button's own text is its glyph, so the count is read off the badge rather than the square.
  const badge = (name: string) =>
    screen.getByRole("button", { name }).element().querySelector(".rounded-mark-badge");
  const sorting = screen.getByRole("button", { name: "Sorting Box" });
  await expect.element(sorting).toBeVisible();
  expect(badge("Sorting Box")?.textContent).toBe("3");
  // The Trash has no count to stand behind, so it wears none.
  expect(badge("Trash")).toBeNull();

  await sorting.click();
  expect(getPlace()?.kind).toBe("sorting");
  await expect.element(sorting).toHaveAttribute("aria-current", "true");
});

import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { getNews, setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Settings } from "./Settings";
import { finishRemove, settingsHeld } from "./settings-store";

// Removing a source forgets its trashed rows; their files stay in the Recycle Bin. Artboards ›
// Sources, "What removing does with its trashed files".

function source(id: number, title: string, trashCount: number, reachable = true): SourceSummary {
  return {
    id,
    root: `D:\\${title}`,
    title,
    kind: "library",
    addedAt: 0,
    indexedAt: null,
    rootFolderId: id,
    reachable,
    itemCount: 4,
    rootCount: 0,
    totalBytes: 0,
    trashCount,
    favorite: false,
  };
}

let sources: SourceSummary[] = [];
let answer: () => void = () => undefined;
let fail: () => void = () => undefined;
const removed: number[] = [];
/** The batches the journal still holds. */
let held = new Set<string>();

beforeEach(async () => {
  await page.viewport(1280, 820);
  sources = [source(1, "Pictures", 2), source(2, "Incoming", 0), source(3, "Archive", 1, false)];
  removed.length = 0;
  held = new Set();
  setNews(null);
  finishRemove(null);
  mockIPC(
    (cmd, payload) => {
      if (cmd === "list_sources") return sources;
      if (cmd === "remove_source") {
        const { id } = payload as { id: number };
        removed.push(id);
        return new Promise<null>((resolve, reject) => {
          answer = () => resolve(null);
          fail = () => reject({ kind: "invalid", message: "the index is busy" });
        });
      }
      if (cmd === "can_undo") return held.has((payload as { batchId: string }).batchId);
      return undefined;
    },
    { shouldMockEvents: true },
  );
  resetIndex();
  await loadIndex();
});

async function asking(title: string) {
  await render(<Settings open onClose={() => undefined} section="sources" />);
  const section = page.getByRole("region", { name: "Sources" });
  await section.getByRole("button", { name: `Remove ${title}` }).click();
  return section.getByRole("group", { name: `Remove ${title}?` });
}

test("the question counts the source's files in the Recycle Bin, which stay there", async () => {
  const question = await asking("Pictures");
  await expect
    .poll(() => question.element().textContent)
    .toContain(
      "The folder stays on disk. Its tags and notes are lost. Its 2 files in the Recycle Bin stay there, out of the app.",
    );
  await expect.element(question.getByText("2 files in the Recycle Bin")).toHaveClass(/text-fg/);
});

test("an offline source's one file is counted in the singular", async () => {
  const question = await asking("Archive");
  await expect
    .poll(() => question.element().textContent)
    .toContain("Its 1 file in the Recycle Bin stays there, out of the app.");
});

test("with nothing in the Trash the question is as it was", async () => {
  const question = await asking("Incoming");
  await expect.element(question.getByText(/Its tags and notes are lost\./)).toBeVisible();
  expect(question.element().textContent).not.toContain("Recycle Bin");
});

test("Remove Source forgets the source with no bar, holding Settings still until it has", async () => {
  const question = await asking("Pictures");
  await question.getByRole("button", { name: "Remove Source" }).click();
  expect(settingsHeld()).toBe(true);
  await expect.element(page.getByRole("searchbox", { name: "Find a setting" })).toBeDisabled();
  expect(question.getByText("Removing Pictures…").query()).toBeNull();
  expect(question.getByRole("progressbar").query()).toBeNull();

  sources = sources.filter((one) => one.id !== 1);
  answer();
  await expect.poll(settingsHeld).toBe(false);
  await expect
    .element(page.getByRole("button", { name: "Remove Pictures" }))
    .not.toBeInTheDocument();
  expect(removed).toEqual([1]);
  expect(
    page
      .getByRole("region", { name: "Sources" })
      .getByText(/Recycle Bin/)
      .query(),
  ).toBeNull();
});

test("a removal that took a tagging's files from the journal takes Undo off its line", async () => {
  const line = "Tagged 3 files dusk.";
  setNews({ kind: "done", line, batchId: "tagged" });
  const question = await asking("Pictures");
  await question.getByRole("button", { name: "Remove Source" }).click();

  answer();
  await expect.poll(settingsHeld).toBe(false);
  expect(getNews()).toEqual({ kind: "said", line });
});

test("a line whose act the journal still holds keeps its Undo after a removal", async () => {
  const kept = { kind: "done", line: "Tagged 3 files dusk.", batchId: "tagged" } as const;
  held.add("tagged");
  setNews(kept);
  const question = await asking("Pictures");
  await question.getByRole("button", { name: "Remove Source" }).click();

  answer();
  await expect.poll(settingsHeld).toBe(false);
  expect(getNews()).toBe(kept);
});

test("a removal that failed leaves the line as it was", async () => {
  const kept = { kind: "done", line: "Tagged 3 files dusk.", batchId: "tagged" } as const;
  setNews(kept);
  const question = await asking("Pictures");
  await question.getByRole("button", { name: "Remove Source" }).click();

  fail();
  await expect.poll(settingsHeld).toBe(false);
  expect(getNews()).toBe(kept);
});

import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { Removal } from "../../ipc/bindings/Removal";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Settings } from "./Settings";
import { finishRemove, settingsHeld } from "./settings-store";

// Removing a source sends its files in the Trash to the Recycle Bin first. Artboards › Sources,
// "What removing does with its trashed files".

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
let answer: (removal: Removal) => void = () => undefined;
const removed: number[] = [];

beforeEach(async () => {
  await page.viewport(1280, 820);
  sources = [source(1, "Pictures", 2), source(2, "Incoming", 0), source(3, "Archive", 1, false)];
  removed.length = 0;
  finishRemove(null);
  mockIPC(
    (cmd, payload) => {
      if (cmd === "list_sources") return sources;
      if (cmd === "remove_source") {
        const { id } = payload as { id: number };
        removed.push(id);
        return new Promise<Removal>((resolve) => {
          answer = resolve;
        });
      }
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

test("the question counts the source's files in the Trash, which go to the Recycle Bin", async () => {
  const question = await asking("Pictures");
  await expect
    .poll(() => question.element().textContent)
    .toContain(
      "The folder stays on disk. Its tags and notes are lost. Its 2 files in the Trash go to the Recycle Bin.",
    );
  await expect.element(question.getByText("2 files in the Trash")).toHaveClass(/text-fg/);
});

test("an offline source's one file is counted in the singular", async () => {
  const question = await asking("Archive");
  await expect
    .poll(() => question.element().textContent)
    .toContain("Its 1 file in the Trash goes to the Recycle Bin.");
});

test("with nothing in the Trash the question is as it was", async () => {
  const question = await asking("Incoming");
  await expect.element(question.getByText(/Its tags and notes are lost\./)).toBeVisible();
  expect(question.element().textContent).not.toContain("Recycle Bin");
});

test("Remove Source gives the answers' place to its line and bar, and Settings holds still", async () => {
  const question = await asking("Pictures");
  await question.getByRole("button", { name: "Remove Source" }).click();
  await expect.element(question.getByText("Removing Pictures…")).toBeVisible();
  expect(question.getByRole("button", { name: "Remove Source" }).query()).toBeNull();
  expect(settingsHeld()).toBe(true);
  await expect.element(page.getByRole("searchbox", { name: "Find a setting" })).toBeDisabled();

  await emit("remove-progress", 50);
  await expect.element(question.getByText("50%")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(question.getByText("Removing Pictures…")).toBeVisible();

  sources = sources.filter((one) => one.id !== 1);
  answer({ kind: "removed" });
  await expect.poll(settingsHeld).toBe(false);
  await expect
    .element(page.getByRole("button", { name: "Remove Pictures" }))
    .not.toBeInTheDocument();
  expect(removed).toEqual([1]);
});

test("a file the Recycle Bin cannot take keeps the source, and the band counts it", async () => {
  const question = await asking("Pictures");
  await question.getByRole("button", { name: "Remove Source" }).click();
  await expect.element(question.getByText("Removing Pictures…")).toBeVisible();

  sources = [source(1, "Pictures", 1), ...sources.slice(1)];
  answer({ kind: "kept", refused: 1, trash: "D:\\Filmstrip\\data\\trash" });
  const section = page.getByRole("region", { name: "Sources" });
  await expect
    .element(
      section.getByText(
        "Pictures was not removed. The Recycle Bin could not take 1 of its files, so it stays in the Trash.",
      ),
    )
    .toBeVisible();
  await expect.element(section.getByText("D:\\Filmstrip\\data\\trash")).toBeVisible();
  expect(settingsHeld()).toBe(false);

  await section.getByRole("button", { name: "Remove Pictures" }).click();
  await expect
    .poll(() => section.getByRole("group", { name: "Remove Pictures?" }).element().textContent)
    .toContain("Its 1 file in the Trash goes to the Recycle Bin.");
});

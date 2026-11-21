import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";

import type { Looked } from "../../ipc/bindings/Looked";
import { getNews, setNews } from "./foot-slot";
import { settleTrash } from "./look-in-bin";

// A look that only restored a file can still forget the row a walk made for it, and with it a
// tagging's whole batch. DECISIONS.md "The Trash is the Recycle Bin".

let looked: Looked = { retired: 0, restored: 0 };
let held = new Set<string>();

beforeEach(() => {
  looked = { retired: 0, restored: 0 };
  held = new Set();
  setNews(null);
  mockIPC((cmd, payload) => {
    if (cmd === "look_in_bin") return looked;
    if (cmd === "can_undo") return held.has((payload as { batchId: string }).batchId);
    return undefined;
  });
});

const line = "Tagged sphinx.jpg dusk.";

test("a look that only restored takes Undo off a line whose act left the journal", async () => {
  setNews({ kind: "done", line, batchId: "tagged" });
  looked = { retired: 0, restored: 1 };

  await settleTrash();

  expect(getNews()).toEqual({ kind: "said", line });
});

test("a look that changed nothing leaves the line as it was", async () => {
  const kept = { kind: "done", line, batchId: "tagged" } as const;
  setNews(kept);

  await settleTrash();

  expect(getNews()).toBe(kept);
});

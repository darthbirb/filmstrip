import { expect, test } from "vitest";

import * as commands from "./commands";

// These run against the dev mock, which vitest.config.ts installs for every test file.

test("the dev mock answers every command a wrapper can send", async () => {
  for (const [name, wrapper] of Object.entries(commands)) {
    if (typeof wrapper !== "function") continue;
    const send = wrapper as (...args: unknown[]) => Promise<unknown>;
    const outcome = await send(1, "library").then(
      () => "answered",
      (error: unknown) => (error instanceof Error ? error.message : "rejected, as the app would"),
    );
    expect(outcome, name).not.toMatch(/does not know/);
  }
});

test("each source's counts agree with what browsing it finds", async () => {
  async function itemsBeneath(folderId: number): Promise<number> {
    const [items, children] = await Promise.all([
      commands.folderItems(folderId),
      commands.folderChildren(folderId),
    ]);
    let total = items.length;
    for (const child of children) {
      expect(await commands.folderItems(child.id), child.title).toHaveLength(child.itemCount);
      total += await itemsBeneath(child.id);
    }
    return total;
  }

  const sources = await commands.listSources();
  expect(sources.map((source) => source.kind)).toContain("sorting");
  for (const source of sources) {
    expect(await itemsBeneath(source.rootFolderId), source.title).toBe(source.itemCount);
  }
});

import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";

import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { getPaneItem, showInPane } from "../pane/pane-store";
import { getPlace, setPlace } from "../place";
import { loadIndex, resetIndex } from "./index-store";

function source(id: number, title: string): SourceSummary {
  return {
    id,
    root: `D:\\${title}`,
    title,
    kind: "library",
    addedAt: 0,
    rootFolderId: id,
    reachable: true,
    itemCount: 2,
    totalBytes: 2,
  };
}

const PICTURES = source(1, "Pictures");
const VIDEOS = source(2, "Videos");
let registered: SourceSummary[] = [];

// This file answers the IPC itself, so the index can be made to lose a source between two reads.
mockIPC((cmd) => {
  if (cmd === "list_sources") return registered;
  if (cmd === "folder_children") return [];
  throw new Error(`unexpected command "${cmd}"`);
});

/** Where the window is, by source, or what other kind of place it is. */
const at = () => {
  const place = getPlace();
  return place?.kind === "folder" ? place.path.map((crumb) => crumb.title).join("/") : place?.kind;
};

beforeEach(async () => {
  resetIndex();
  setPlace(null);
  showInPane(null);
  registered = [PICTURES, VIDEOS];
  await loadIndex();
});

test("the window settles on the first library it finds", () => {
  expect(at()).toBe("Pictures");
});

test("a source removed while you are in it is left, not held open", async () => {
  setPlace({ kind: "folder", sourceId: VIDEOS.id, path: [{ id: 2, title: "Videos" }] });
  showInPane(7, getPlace());
  registered = [PICTURES];
  await loadIndex();

  expect(at()).toBe("Pictures");
  expect(getPaneItem()).toBeNull();
});

test("a source removed elsewhere leaves where you are and what you are looking at alone", async () => {
  setPlace({ kind: "folder", sourceId: PICTURES.id, path: [{ id: 1, title: "Pictures" }] });
  showInPane(7, getPlace());
  registered = [PICTURES];
  await loadIndex();

  expect(at()).toBe("Pictures");
  expect(getPaneItem()).toBe(7);
});

test("with every source gone there is nowhere to be", async () => {
  registered = [];
  await loadIndex();

  expect(getPlace()).toBeNull();
});

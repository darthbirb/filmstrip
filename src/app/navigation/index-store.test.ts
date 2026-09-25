import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";

import type { FolderEntry } from "../../ipc/bindings/FolderEntry";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { getPaneItem, getPaneOrigin, showInPane } from "../pane/pane-store";
import { getPlace, type Place, setPlace } from "../place";
import { loadIndex, refreshIndex, resetIndex } from "./index-store";
import { getOpenFolders } from "./open-folders";

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
    favorite: false,
  };
}

const PICTURES = source(1, "Pictures");
const VIDEOS = source(2, "Videos");
let registered: SourceSummary[] = [];

const entry = (id: number, parentId: number | null, title: string): FolderEntry => ({
  id,
  parentId,
  sourceId: 1,
  title,
});
// Pictures › Trips › Cairo, and People beside Trips.
const TREE = [
  entry(1, null, "Pictures"),
  entry(10, 1, "Trips"),
  entry(11, 10, "Cairo"),
  entry(12, 1, "People"),
];
let folders: FolderEntry[] | null = null;

// This file answers the IPC itself, so the index can be made to lose a source between two reads.
mockIPC((cmd) => {
  if (cmd === "list_sources") return registered;
  if (cmd === "folder_children") return [];
  if (cmd === "list_folders" && folders) return folders;
  throw new Error(`unexpected command "${cmd}"`);
});

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 10, title: "Trips" },
    { id: 11, title: "Cairo" },
  ],
};

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
  folders = null;
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

test("a folder moved takes you with it, and the tree opens down to where it went", async () => {
  folders = TREE;
  setPlace(CAIRO);
  showInPane(7, CAIRO);
  folders = TREE.map((one) => (one.id === 11 ? { ...one, parentId: 12 } : one));
  await refreshIndex();

  expect(at()).toBe("Pictures/People/Cairo");
  expect([...getOpenFolders()]).toEqual(expect.arrayContaining([1, 12]));
  expect(getPaneItem()).toBe(7);
  expect(getPaneOrigin()).toEqual(getPlace());
});

test("a folder deleted while you are in it leaves you in its parent, with the pane emptied", async () => {
  folders = TREE;
  setPlace(CAIRO);
  showInPane(7, CAIRO);
  folders = TREE.filter((one) => one.id !== 11);
  await refreshIndex();

  expect(at()).toBe("Pictures/Trips");
  expect(getPaneItem()).toBeNull();
});

test("a folder renamed above you is renamed where you are", async () => {
  folders = TREE.map((one) => (one.id === 10 ? { ...one, title: "Journeys" } : one));
  setPlace(CAIRO);
  await refreshIndex();

  expect(at()).toBe("Pictures/Journeys/Cairo");
});

test("with every source gone there is nowhere to be", async () => {
  registered = [];
  await loadIndex();

  expect(getPlace()).toBeNull();
});

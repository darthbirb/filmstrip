import { beforeEach, expect, test } from "vitest";

import type { Place } from "../place";
import {
  addToPane,
  getPaneItem,
  getPaneOrigin,
  getPaneSet,
  leavePane,
  paneDrop,
  paneFileOrigin,
  paneSetLimit,
  paneSetPlaying,
  showInPane,
  whenShownInPane,
} from "./pane-store";

const CAIRO: Place = { kind: "folder", sourceId: 1, path: [{ id: 6, title: "Cairo" }] };
const TRIPS: Place = { kind: "folder", sourceId: 1, path: [{ id: 4, title: "Trips" }] };

beforeEach(() => showInPane(null));

test("the limit is the token sheet's pane-set", () => {
  const root = getComputedStyle(document.documentElement);
  expect(paneSetLimit()).toBe(Number.parseInt(root.getPropertyValue("--pane-set"), 10));
  expect(paneSetLimit()).toBeGreaterThan(1);
});

test("the clips that play at once are the token sheet's pane-set-playing", () => {
  const root = getComputedStyle(document.documentElement);
  expect(paneSetPlaying()).toBe(Number.parseInt(root.getPropertyValue("--pane-set-playing"), 10));
  expect(paneSetPlaying()).toBeLessThanOrEqual(paneSetLimit());
});

test("a drop adds what is new, in the order carried, after what the pane shows", () => {
  showInPane(1, CAIRO);
  expect(paneDrop([3, 1, 2, 3], 12)).toEqual({ kind: "add", adds: [3, 2], of: 2, replaces: false });
  addToPane([3, 2], TRIPS);
  expect(getPaneSet()).toEqual([1, 3, 2]);
  expect(getPaneItem()).toBe(1);
  // The strip stays on the first file's place; each other file keeps its own.
  expect(getPaneOrigin()).toEqual(CAIRO);
  expect(paneFileOrigin(3)).toEqual(TRIPS);
});

test("over an empty pane the files take its place, and the pane is asked to show itself", () => {
  let asked = 0;
  const stop = whenShownInPane(() => {
    asked += 1;
  });
  expect(paneDrop([5, 6], 12)).toEqual({ kind: "add", adds: [5, 6], of: 2, replaces: true });
  addToPane([5, 6], TRIPS);
  stop();
  expect(getPaneSet()).toEqual([5, 6]);
  expect(getPaneOrigin()).toEqual(TRIPS);
  expect(asked).toBe(1);
});

test("past the limit only what fits is taken; full, or nothing new, the drop is refused", () => {
  showInPane(1, CAIRO);
  addToPane([2, 3, 4, 5, 6, 7, 8, 9, 10], CAIRO);
  expect(paneDrop([20, 21, 22, 23, 24], 12)).toEqual({
    kind: "add",
    adds: [20, 21],
    of: 5,
    replaces: false,
  });
  addToPane([20, 21], CAIRO);
  expect(paneDrop([30], 12)).toEqual({ kind: "refuse", why: "The pane shows 12 at most" });
  // A file already shown is not counted against the limit, nor added again.
  expect(paneDrop([1, 2], 12)).toEqual({ kind: "refuse", why: "Already in the pane" });
});

test("taking files out keeps the rest, the next becoming the first, and never empties the pane", () => {
  showInPane(1, CAIRO);
  addToPane([2, 3], TRIPS);
  leavePane([1]);
  expect(getPaneSet()).toEqual([2, 3]);
  expect(getPaneItem()).toBe(2);
  expect(getPaneOrigin()).toEqual(TRIPS);
  leavePane([2, 3]);
  expect(getPaneSet()).toEqual([2]);
  // One file alone is the ordinary pane, which nothing takes out.
  leavePane([2]);
  expect(getPaneSet()).toEqual([2]);
});

test("a click shows one file alone again", () => {
  showInPane(1, CAIRO);
  addToPane([2, 3], CAIRO);
  showInPane(3, CAIRO);
  expect(getPaneSet()).toEqual([3]);
});

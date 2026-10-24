import { convertFileSrc } from "@tauri-apps/api/core";
import { type PointerEvent as ReactPointerEvent, useSyncExternalStore } from "react";

import { formatCount } from "../../lib/format";
import { DragGhost } from "../../ui/DragGhost";
import { setNews } from "../navigation/foot-slot";
import { moveFiles } from "../pane/move-picker";
import { addToPane, paneDrop, paneSetLimit } from "../pane/pane-store";
import { getPlace } from "../place";
import type { CheckedFile } from "./selection";

// A tile or a set dragged onto a tree row is Move to… that row. Artboards › Dragging onto a folder.
// Onto the pane, it adds them to what the pane shows. Pane › several.

/** What a row does with a drop: takes it, opening first if it is shut and held, or says why not. */
export type Landing =
  | { kind: "accept"; to: { id: number; title: string }; open?: () => void }
  | { kind: "refuse"; why: string }
  /** The pane takes these, of so many carried new, beside what it shows or in its place. */
  | { kind: "pane"; adds: number[]; of: number; replaces: boolean };

/** What the drag is over when it is over the pane rather than a row. */
export const PANE = "pane";

/** Navigation's answer for each of its rows; null for a row that is no place to land. */
export type Resolver = (rowId: string, carried: readonly CheckedFile[]) => Landing | null;

type Drag = {
  carried: readonly CheckedFile[];
  pressed: CheckedFile;
  x: number;
  y: number;
  over: { rowId: string; landing: Landing } | null;
};

let resolve: Resolver = () => null;
let drag: Drag | null = null;
const listeners = new Set<() => void>();

/** Navigation says what each row does with a drop; the newest answer stands. */
export function setDropResolver(next: Resolver) {
  resolve = next;
}

function set(next: Drag | null) {
  drag = next;
  const refused = next?.over?.landing.kind === "refuse";
  if (refused) document.documentElement.dataset.drag = "refused";
  else delete document.documentElement.dataset.drag;
  for (const listener of listeners) listener();
}

/** Whether a drag is on, whose Escape is its own. */
export function dragging() {
  return drag !== null;
}

export function useDrag() {
  return useSyncExternalStore(subscribe, () => drag);
}

const files = (count: number) => `${formatCount(count)} ${count === 1 ? "file" : "files"}`;

/** A token's length in pixels, or a duration's milliseconds. */
function token(name: string) {
  const root = getComputedStyle(document.documentElement);
  const value = Number.parseFloat(root.getPropertyValue(name));
  return root.getPropertyValue(name).trim().endsWith("rem")
    ? value * Number.parseFloat(root.fontSize)
    : value;
}

/** The first box above the tree that scrolls, which a drag near its edges scrolls. */
function treeScroller() {
  for (let at = document.querySelector("[role=tree]")?.parentElement; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at;
  }
  return null;
}

/**
 * Near the tree's top or foot the tree scrolls, a row's height a second, for as long as the
 * pointer rests there; `moved` follows each step. Returns the way to stop it.
 */
export function scrollTreeNear(at: () => { x: number; y: number }, moved: () => void) {
  const scroller = treeScroller();
  let frame = 0;
  let last: number | undefined;
  let owed = 0;
  const scroll = (now: number) => {
    frame = requestAnimationFrame(scroll);
    const since = last === undefined ? 0 : Math.min(now - last, 100) / 1000;
    last = now;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const edge = token("--spacing-row");
    const { x, y } = at();
    const inside = x >= box.left && x <= box.right;
    const step = !inside ? 0 : y < box.top + edge ? -1 : y > box.bottom - edge ? 1 : 0;
    if (step === 0 || Math.sign(owed) === -step) owed = 0;
    if (step === 0) return;
    // Whole pixels only, so a frame's fraction is never rounded away at a high refresh rate.
    owed += step * edge * since;
    const whole = Math.trunc(owed);
    if (whole === 0) return;
    owed -= whole;
    scroller.scrollTop += whole;
    moved();
  };
  frame = requestAnimationFrame(scroll);
  return () => cancelAnimationFrame(frame);
}

/**
 * A press on a tile, which becomes a drag once it has moved a tile-gap; less than that is a click.
 * `carry` is what the drag takes when it starts: the set when the tile is checked, else the tile.
 * The ghost wears the pressed tile's picture, or the first carried file's that has one.
 */
export function pressTile(
  event: ReactPointerEvent,
  pressed: CheckedFile,
  carry: () => readonly CheckedFile[],
) {
  if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey) return;
  const start = { x: event.clientX, y: event.clientY };
  const slop = token("--spacing-tile-gap");
  let at = start;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let stopScrolling = () => {};

  const track = () => {
    if (!drag) return;
    const under = document.elementFromPoint(at.x, at.y);
    const row = under?.closest<HTMLElement>("[data-row]");
    const onPane = !row && Boolean(under?.closest("[data-drop=pane]"));
    const rowId = onPane ? PANE : (row?.dataset.row ?? null);
    const landing = onPane
      ? toPane(drag.carried)
      : rowId === null
        ? null
        : resolve(rowId, drag.carried);
    const over = rowId !== null && landing ? { rowId, landing } : null;
    if (over?.rowId !== drag.over?.rowId) {
      clearTimeout(hold);
      const open = over?.landing.kind === "accept" ? over.landing.open : undefined;
      if (open) hold = setTimeout(open, token("--hold"));
    }
    set({ ...drag, x: at.x, y: at.y, over });
  };

  const move = (next: PointerEvent) => {
    at = { x: next.clientX, y: next.clientY };
    if (!drag) {
      if (Math.hypot(at.x - start.x, at.y - start.y) < slop) return;
      set({ carried: carry(), pressed, x: at.x, y: at.y, over: null });
      stopScrolling = scrollTreeNear(() => at, track);
    }
    track();
  };

  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", putAway, true);
    clearTimeout(hold);
    stopScrolling();
    const was = drag;
    set(null);
    if (!was) return null;
    // The press was a drag, so the click it also makes is not a click on what lies under it.
    const swallow = (click: MouseEvent) => {
      click.preventDefault();
      click.stopPropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true));
    return was;
  };

  const up = () => {
    const was = stop();
    const landing = was?.over?.landing;
    if (was && landing?.kind === "pane") {
      addToPane(landing.adds, getPlace());
      if (landing.adds.length < landing.of) {
        const limit = paneSetLimit();
        const line = `Added ${landing.adds.length} of ${files(landing.of)} to the pane. It shows ${limit} at most.`;
        setNews({ kind: "said", line });
      }
    }
    if (was && landing?.kind === "accept") {
      void moveFiles(
        was.carried.map((row) => row.id),
        landing.to,
      );
    }
  };

  const cancel = () => void stop();

  // Escape puts the ghost away and moves nothing, and is the drag's alone.
  const putAway = (key: KeyboardEvent) => {
    if (key.key !== "Escape" || !drag) return;
    key.preventDefault();
    key.stopPropagation();
    stop();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", putAway, true);
}

/** What the pane would do with these files: the files ride in the order they were carried. */
function toPane(carried: readonly CheckedFile[]): Landing {
  const answer = paneDrop(carried.map((row) => row.id));
  return answer.kind === "refuse" ? answer : { ...answer, kind: "pane" };
}

/** The words for a drop on the pane: "Add 2 files to the pane", "Add 2 of 5 files to the pane". */
function onPaneWords(landing: Extract<Landing, { kind: "pane" }>) {
  const count =
    landing.adds.length < landing.of
      ? `${formatCount(landing.adds.length)} of ${files(landing.of)}`
      : files(landing.adds.length);
  return landing.replaces ? `Show ${count} in the pane` : `Add ${count} to the pane`;
}

/** The whole pane wears the accepting row's ring inside its edge while a drag over it will be taken. */
export function PaneDropRing() {
  const now = useDrag();
  if (now?.over?.rowId !== PANE || now.over.landing.kind !== "pane") return null;
  return (
    <span
      aria-hidden="true"
      data-pane-lit
      className="pointer-events-none absolute inset-0 z-(--z-overlay) rounded-control inset-ring-2 inset-ring-plate"
    />
  );
}

/** The ghost, while a drag is on. */
export function Dragging() {
  const now = useDrag();
  if (!now) return null;
  const top = [now.pressed, ...now.carried].find((row) => row.thumb);
  const landing = now.over?.landing;
  const count = files(now.carried.length);
  const label =
    landing?.kind === "accept"
      ? `Move ${count} to ${landing.to.title}`
      : landing?.kind === "pane"
        ? onPaneWords(landing)
        : landing?.kind === "refuse"
          ? landing.why
          : count;
  return (
    <DragGhost
      x={now.x}
      y={now.y}
      thumb={top?.thumb ? convertFileSrc(top.thumb) : undefined}
      stacked={now.carried.length > 1}
      refused={landing?.kind === "refuse"}
      label={label}
    />
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

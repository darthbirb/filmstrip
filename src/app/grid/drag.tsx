import { convertFileSrc } from "@tauri-apps/api/core";
import { type PointerEvent as ReactPointerEvent, useSyncExternalStore } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { formatCount } from "../../lib/format";
import { DragGhost } from "../../ui/DragGhost";
import { moveFiles } from "../pane/move-picker";

// A tile or a set dragged onto a tree row is Move to… that row. Artboards › Dragging onto a folder.

/** What a row does with a drop: takes it, opening first if it is shut and held, or says why not. */
export type Landing =
  | { kind: "accept"; to: { id: number; title: string }; open?: () => void }
  | { kind: "refuse"; why: string };

/** Navigation's answer for each of its rows; null for a row that is no place to land. */
export type Resolver = (rowId: string, carried: readonly ItemRow[]) => Landing | null;

type Drag = {
  carried: readonly ItemRow[];
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
 * A press on a tile, which becomes a drag once it has moved a tile-gap; less than that is a click.
 * `carry` is what the drag takes when it starts: the set when the tile is checked, else the tile.
 */
export function pressTile(event: ReactPointerEvent, carry: () => readonly ItemRow[]) {
  if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey) return;
  const start = { x: event.clientX, y: event.clientY };
  const slop = token("--spacing-tile-gap");
  let at = start;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let scroller: HTMLElement | null = null;

  const track = () => {
    if (!drag) return;
    const row = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>("[data-row]");
    const rowId = row?.dataset.row ?? null;
    const landing = rowId === null ? null : resolve(rowId, drag.carried);
    const over = rowId !== null && landing ? { rowId, landing } : null;
    if (over?.rowId !== drag.over?.rowId) {
      clearTimeout(hold);
      const open = over?.landing.kind === "accept" ? over.landing.open : undefined;
      if (open) hold = setTimeout(open, token("--hold"));
    }
    set({ ...drag, x: at.x, y: at.y, over });
  };

  // Near the tree's top or foot the tree scrolls, a row's height a second, while the ghost rests.
  const scroll = () => {
    frame = requestAnimationFrame(scroll);
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const edge = token("--spacing-row");
    if (at.x < box.left || at.x > box.right) return;
    const step = at.y < box.top + edge ? -1 : at.y > box.bottom - edge ? 1 : 0;
    if (step === 0) return;
    scroller.scrollTop += (step * edge) / 60;
    track();
  };

  const move = (next: PointerEvent) => {
    at = { x: next.clientX, y: next.clientY };
    if (!drag) {
      if (Math.hypot(at.x - start.x, at.y - start.y) < slop) return;
      set({ carried: carry(), x: at.x, y: at.y, over: null });
      scroller = treeScroller();
      frame = requestAnimationFrame(scroll);
    }
    track();
  };

  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", putAway, true);
    clearTimeout(hold);
    cancelAnimationFrame(frame);
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

/** The ghost, while a drag is on. */
export function Dragging() {
  const now = useDrag();
  if (!now) return null;
  const [top] = now.carried;
  const landing = now.over?.landing;
  const count = files(now.carried.length);
  const label =
    landing?.kind === "accept"
      ? `Move ${count} to ${landing.to.title}`
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

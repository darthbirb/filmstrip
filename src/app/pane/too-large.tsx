import { Fragment, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Stayed } from "../../ipc/bindings/Stayed";
import { revealItem, sendToRecycleBin } from "../../ipc/commands";
import { formatBytes } from "../../lib/format";
import { LIST_HEADING, LIST_ROW, listRow } from "../../ui/Banner";
import { Question } from "../../ui/Question";
import { libraryChanged } from "../library";
import { setNews } from "../navigation/foot-slot";
import {
  binRefusedDetail,
  binRefusedLine,
  sentToBinLine,
  stayedGroups,
  tooLargeDetail,
  tooLargeLine,
} from "../undo/lines";
import { ShowInExplorer } from "../undo/ReportBanner";
import { neighbour } from "./delete";
import { getPaneItem, getPaneOrigin, paneMovesOn, showInPane } from "./pane-store";

// What Delete asks of files too large for the Trash, above the grid, and what the Recycle Bin
// then would not take. Artboards › The Trash's limits; DECISIONS.md "Expiry goes to the Recycle Bin".

type Asking = {
  rows: Stayed[];
  /** How many files the delete was asked for. */
  whole: number;
  /** Each file's size, as the Trash refused it. */
  sizes: ReadonlyMap<number, number>;
  /** The Recycle Bin would not take these, so there is nothing left to ask. */
  refused: boolean;
  /** What follows once every one has gone, as a folder's delete goes on, saying what was sent. */
  afterwards?: (sent: string) => void;
  back: HTMLElement | null;
  id: number;
};

let asking: Asking | null = null;
let count = 0;
const listeners = new Set<() => void>();

function ask(next: Omit<Asking, "id"> | null) {
  asking = next ? { ...next, id: count++ } : null;
  for (const listener of listeners) listener();
}

/**
 * Asks whether files the Trash refused for their size go to the Recycle Bin instead; `afterwards`
 * follows once every one has gone. Nothing is sent without an answer.
 */
export function askTooLarge(
  rows: readonly Stayed[],
  whole: number,
  afterwards?: (sent: string) => void,
) {
  const sizes = new Map<number, number>();
  for (const row of rows) if (row.reason.kind === "tooLarge") sizes.set(row.id, row.reason.bytes);
  const focused = document.activeElement;
  ask({
    rows: [...rows],
    whole,
    sizes,
    refused: false,
    afterwards,
    back: focused instanceof HTMLElement ? focused : null,
  });
}

/** Rows the Trash refused for their size, out of the rest that stayed. */
export function tooLargeOf(rows: readonly Stayed[]) {
  return rows.filter((row) => row.reason.kind === "tooLarge");
}

export function getTooLarge() {
  return asking;
}

/** Puts the question away, for tests. */
export function resetTooLarge() {
  ask(null);
}

async function send(asked: Asking) {
  ask(null);
  const ids = asked.rows.map((row) => row.id);
  const shown = getPaneItem();
  const origin = getPaneOrigin();
  const next = paneMovesOn(ids) ? await neighbour(origin, ids) : shown;
  const done = await sendToRecycleBin(ids).catch(() => null);
  if (!done) return;
  const stayed = new Set(done.refused.map((row) => row.id));
  const went = asked.rows.filter((row) => !stayed.has(row.id));
  const sent = sentToBinLine(went.length, went.length === 1 ? went[0]?.name : undefined);
  const after = done.refused.length === 0 ? asked.afterwards : undefined;
  if (went.length > 0 && !after) setNews({ kind: "recycled", line: sent });
  if (done.refused.length > 0) {
    ask({ ...asked, rows: done.refused, refused: true, afterwards: undefined });
  }
  if (shown !== null && !stayed.has(shown) && next !== shown) {
    showInPane(next, origin);
  }
  await libraryChanged();
  after?.(sent);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The question, or what the Recycle Bin would not take, while either is there. */
export function TooLargeQuestion() {
  const shown = useSyncExternalStore(subscribe, () => asking);
  return shown ? <Asked key={shown.id} asked={shown} /> : null;
}

function Asked({ asked }: { asked: Asking }) {
  const { rows, whole, sizes, refused } = asked;
  const [open, setOpen] = useState(true);
  const focusBack = useRef(asked.back);

  // Answered or put away, the keyboard goes back to where Delete was asked from.
  useLayoutEffect(
    () => () => {
      queueMicrotask(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost) focusBack.current?.focus();
      });
    },
    [],
  );

  return (
    <Question
      sentence={refused ? binRefusedLine(rows) : tooLargeLine(rows, whole)}
      detail={refused ? binRefusedDetail(rows.length) : tooLargeDetail(rows)}
      last={
        refused ? undefined : { label: "Send to Recycle Bin", onChoose: () => void send(asked) }
      }
      files={
        rows.length > 1
          ? {
              open,
              onToggle: () => setOpen(!open),
              list: <Sizes rows={rows} sizes={sizes} />,
            }
          : undefined
      }
      dismiss={refused ? "Dismiss" : "Keep It"}
      onDismiss={() => ask(null)}
    />
  );
}

const COLUMNS = listRow("control");

/** The files under where each still is, with its size. */
function Sizes({ rows, sizes }: { rows: Stayed[]; sizes: ReadonlyMap<number, number> }) {
  return stayedGroups(rows).map((group, index) => (
    <Fragment key={group.heading}>
      <div className={`${COLUMNS} ${LIST_HEADING} ${index > 0 ? "border-line border-t" : ""}`}>
        <span className="truncate">{group.heading}</span>
        <span>{index === 0 ? "Size" : ""}</span>
        <span />
      </div>
      {group.rows.map((row) => {
        const bytes = sizes.get(row.id);
        return (
          <div key={row.id} className={`${COLUMNS} ${LIST_ROW}`}>
            <span className="truncate text-fg">{row.name}</span>
            <span className="truncate text-fg-dim tabular-nums">
              {bytes === undefined ? "" : formatBytes(bytes)}
            </span>
            <ShowInExplorer
              name={row.name}
              onClick={() => void revealItem(row.id).catch(() => undefined)}
            />
          </div>
        );
      })}
    </Fragment>
  ));
}

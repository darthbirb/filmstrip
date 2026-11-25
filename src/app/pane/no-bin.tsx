import { Fragment, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { BinlessDrive } from "../../ipc/bindings/BinlessDrive";
import { revealItem } from "../../ipc/commands";
import { formatBytes } from "../../lib/format";
import { LIST_HEADING, LIST_ROW, listRow } from "../../ui/Banner";
import { Question } from "../../ui/Question";
import { failed } from "../failure";
import { noBinDetail, noBinHead, shownFailed } from "../undo/lines";
import { ShowInExplorer } from "../undo/ReportBanner";
import { setFullScreen } from "./full-screen";

/** Delete's question about files on drives with no Recycle Bin, and what answering yes does. */
export type NoBinAsking = {
  drives: BinlessDrive[];
  /** How many files the selection held, these among them. */
  whole: number;
  /** How many of the rest went to the Recycle Bin. */
  went: number;
  back: HTMLElement | null;
  onDelete: () => void;
};

// One question at a time, above the grid. Artboards › The Trash in the Recycle Bin.
let asking: NoBinAsking | null = null;
let count = 0;
const listeners = new Set<() => void>();

/** Asks, once for them all, before files on drives with no Recycle Bin are deleted for good. */
export function askNoBin(next: NoBinAsking | null) {
  // Full screen hides the grid's notices, where this is drawn. DECISIONS.md "A drive with no Recycle Bin".
  if (next) setFullScreen(false);
  asking = next;
  count += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The question, while one is asked. */
export function NoBinQuestion() {
  const shown = useSyncExternalStore(subscribe, () => asking);
  return shown ? <Asked key={count} {...shown} /> : null;
}

const COLUMNS = listRow("control");

function Asked({ drives, whole, went, back, onDelete }: NoBinAsking) {
  const [open, setOpen] = useState(true);
  const focusBack = useRef(back);
  const files = drives.flatMap((drive) => drive.files);

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
      sentence={noBinHead(
        drives.map((drive) => drive.drive),
        files.length,
        whole,
      )}
      detail={noBinDetail(files, whole, went)}
      last={{
        label: "Delete Permanently",
        onChoose: () => {
          askNoBin(null);
          onDelete();
        },
      }}
      files={
        files.length > 1
          ? { open, onToggle: () => setOpen(!open), list: <DriveList drives={drives} /> }
          : undefined
      }
      guarded
      cancelOnLine
      onDismiss={() => askNoBin(null)}
    />
  );
}

/** The files asked about, under the drive each is on, each with its size. */
function DriveList({ drives }: { drives: readonly BinlessDrive[] }) {
  return drives.map((drive, index) => (
    <Fragment key={drive.drive}>
      <div className={`${COLUMNS} ${LIST_HEADING} ${index > 0 ? "border-line border-t" : ""}`}>
        <span className="truncate">On {drive.drive}</span>
        <span>{index === 0 ? "Size" : ""}</span>
        <span />
      </div>
      {drive.files.map((file) => (
        <div key={file.id} className={`${COLUMNS} ${LIST_ROW}`}>
          <span className="truncate text-fg">{file.name}</span>
          <span className="truncate text-fg-dim tabular-nums">{formatBytes(file.bytes)}</span>
          <ShowInExplorer
            name={file.name}
            onClick={() => void revealItem(file.id).catch(failed(shownFailed(file.name)))}
          />
        </div>
      ))}
    </Fragment>
  ));
}

/** Puts the question away, for tests. */
export function resetNoBinQuestion() {
  askNoBin(null);
}

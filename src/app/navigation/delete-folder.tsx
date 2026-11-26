import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Batch } from "../../ipc/bindings/Batch";
import type { BinlessDrive } from "../../ipc/bindings/BinlessDrive";
import type { Contents } from "../../ipc/bindings/Contents";
import type { Deleted } from "../../ipc/bindings/Deleted";
import type { DeleteReport } from "../../ipc/bindings/DeleteReport";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { binlessUnder, deleteFolder, folderDetail, folderFileCount } from "../../ipc/commands";
import { Question } from "../../ui/Question";
import { sayFailed, unasked } from "../failure";
import { libraryChanged } from "../library";
import { dropPaneFolder, getPaneFolder, whenShownInPane } from "../pane/pane-store";
import { getPreferences, updatePreferences } from "../preferences";
import { SORTING_BOX, sortingDetail } from "../sorting-box";
import {
  folderCancelledLine,
  folderForGoodLine,
  folderKeptBanner,
  folderKeptLine,
  folderNoBinDetail,
  folderStayedBanner,
  folderStayedLine,
  holdsLine,
  reasonSentence,
} from "../undo/lines";
import { showReport } from "../undo/report-store";
import { afterAct } from "../undo/undo";
import { setNews } from "./foot-slot";
import { useIndex } from "./index-store";

/** A folder about to be deleted. */
export type Doomed = { id: number; name: string };

// The one question a folder's delete asks, drawn above the grid. DECISIONS.md "Right-click menus".
let asking: {
  folder: Doomed;
  held: number;
  back: HTMLElement | null;
  /** Drives with no Recycle Bin its files are on, which deleting them would empty permanently. */
  binless: BinlessDrive[];
} | null = null;
const listeners = new Set<() => void>();

function ask(next: typeof asking) {
  asking = next;
  for (const listener of listeners) listener();
}

/** The sorting sources a folder's files can move to, in the order Settings lists them. */
export function sortingSources(sources: readonly SourceSummary[] | null) {
  return (sources ?? []).filter((source) => source.kind === "sorting" && source.reachable);
}

/**
 * Deletes a folder: an empty one at once, one with files into the default sorting source when
 * there is one, and otherwise after asking where its files go.
 */
export async function deleteFolderAsking(folder: Doomed, sources: readonly SourceSummary[]) {
  const failing = (error: unknown) => {
    sayFailed(`Could not delete ${folder.name}.`, error);
    return null;
  };
  const held = await folderFileCount(folder.id).catch(failing);
  if (held === null) return;
  if (held === 0) return settle(folder, null, 0);
  const into = getPreferences().deleteInto;
  if (sortingSources(sources).some((source) => source.id === into) && into !== undefined) {
    return settle(folder, { kind: "moveTo", sourceId: into }, held);
  }
  const focused = document.activeElement;
  const binless = await binlessUnder(folder.id).catch(failing);
  if (binless === null) return;
  showReport(null);
  ask({ folder, held, back: focused instanceof HTMLElement ? focused : null, binless });
}

/**
 * Sends the folder where its files were told to go, and says what happened: the line at the foot
 * for what went, the banner over the grid for a folder that stayed. One holding more files than
 * a delete sends at once is a job, which says so when it ends. DECISIONS.md "Undo".
 */
async function settle(folder: Doomed, contents: Contents | null, held: number) {
  const inPane = await showsInPane(folder.id);
  const done = await deleteFolder(folder.id, contents).catch((error: unknown) => {
    sayFailed(`Could not delete ${folder.name}.`, error);
    return null;
  });
  if (!done) return;
  if (done.kind === "started") {
    deleting.set(done.jobId, { folderId: folder.id, inPane: Promise.resolve(inPane) });
    watchPane();
    return;
  }
  settled(folder, contents, held, inPane, done.batch, done.report);
  await libraryChanged();
}

// Folders being deleted on the queue, by job, with the folder the pane last showed in them.
const deleting = new Map<number, { folderId: number; inPane: Promise<number | null> }>();
let unwatchPane: (() => void) | null = null;

function watchPane() {
  unwatchPane ??= whenShownInPane(() => {
    for (const job of deleting.values()) {
      const was = job.inPane;
      const now = showsInPane(job.folderId);
      job.inPane = Promise.all([was, now]).then(([before, shown]) => shown ?? before);
    }
  });
}

function settled(
  folder: Doomed,
  contents: Contents | null,
  held: number,
  inPane: number | null,
  batch: Batch | null,
  report: DeleteReport,
) {
  if (report.deleted && inPane !== null) dropPaneFolder((shown) => shown.folderId === inPane);
  const into = contents?.kind === "moveTo" ? SORTING_BOX : null;
  const forGood = contents?.kind === "permanently";
  const binned = batch?.files ?? 0;
  const { outright } = report;
  if (report.deleted) {
    const line = outright > 0 ? folderForGoodLine(folder.name, binned, outright) : undefined;
    if (batch) afterAct(batch, 0, line);
    else if (line) setNews({ kind: "said", line });
    showReport(null);
  } else if (forGood) {
    const line = folderKeptLine(folder.name, binned, outright, held);
    if (line && batch) afterAct(batch, 0, line);
    else if (line) setNews({ kind: "said", line });
    showReport({
      sentence: folderKeptBanner(folder.name, binned, outright, held),
      rows: report.refused,
      retry: () => void settle(folder, contents, held - binned - outright),
    });
  } else {
    const carried = batch?.files ?? 0;
    if (batch) afterAct(batch, 0, folderStayedLine(folder.name, carried, held, into));
    showReport({
      sentence: folderStayedBanner(folder.name, carried, held, into),
      rows: report.refused,
      retry: () => void settle(folder, contents, held - carried),
    });
  }
}

/**
 * How a folder's delete on the queue ended: as one inside the command does, or, cancelled, the
 * Line counting what went and the folder staying. One that stopped on its own says why.
 */
export async function afterFolderDeleted(deleted: Extract<Deleted, { kind: "folder" }>) {
  const job = deleting.get(deleted.jobId);
  deleting.delete(deleted.jobId);
  if (deleting.size === 0) {
    unwatchPane?.();
    unwatchPane = null;
  }
  const inPane = job ? await job.inPane : null;
  await libraryChanged();
  const { batch, report, whole, name, stopped } = deleted;
  const folder = { id: deleted.folderId, name };
  const binned = batch?.files ?? 0;
  if (stopped || deleted.cancelled) {
    const line = folderCancelledLine(name, binned, report.outright, whole);
    const why = stopped ? reasonSentence(stopped) : null;
    const said = [line, why].filter((part) => part !== null).join(" ");
    if (batch) afterAct(batch, 0, said);
    else if (why) setNews({ kind: "keyRefused", line: `Could not delete ${name}.`, detail: why });
    else if (line) setNews({ kind: "said", line });
    return;
  }
  settled(folder, deleted.contents, whole, inPane, batch, report);
}

/** The folder the pane shows, when it is this one or inside it. */
async function showsInPane(folderId: number) {
  const shown = getPaneFolder();
  if (!shown) return null;
  if (shown.folderId === folderId) return shown.folderId;
  const detail = await folderDetail(shown.folderId).catch(unasked);
  return detail?.path.some((crumb) => crumb.id === folderId) ? shown.folderId : null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The question, while one is asked. */
export function DeleteQuestion() {
  const shown = useSyncExternalStore(subscribe, () => asking);
  return shown ? <Asked key={shown.folder.id} {...shown} /> : null;
}

function Asked({ folder, held, back, binless }: NonNullable<typeof asking>) {
  const { sources } = useIndex();
  const [always, setAlways] = useState(false);
  const every = sources ?? [];
  const sorting = sortingSources(every);
  const focusBack = useRef(back);

  // Answered or put away, the keyboard goes back to the row it was asked from.
  useLayoutEffect(
    () => () => {
      queueMicrotask(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost) focusBack.current?.focus();
      });
    },
    [],
  );

  const answer = (contents: Contents) => {
    if (always && contents.kind === "moveTo") updatePreferences({ deleteInto: contents.sourceId });
    ask(null);
    void settle(folder, contents, held);
  };

  const asked = binless.flatMap((drive) => drive.files);
  const bytes = asked.reduce((sum, file) => sum + file.bytes, 0);
  const forGood = asked.length > 0;

  return (
    <Question
      sentence={holdsLine(folder.name, held)}
      detail={
        forGood
          ? folderNoBinDetail(
              binless.map((drive) => drive.drive),
              asked.length,
              held,
              bytes,
            )
          : undefined
      }
      choices={sorting.map((source) => ({
        id: String(source.id),
        label: `Move Files to ${SORTING_BOX}`,
        short: SORTING_BOX,
        detail: sortingDetail(source, every),
        onChoose: () => answer({ kind: "moveTo", sourceId: source.id }),
      }))}
      choiceGlyph="sortingBox"
      fold="Move Files to…"
      last={
        forGood
          ? {
              label: "Delete Files Permanently",
              onChoose: () => answer({ kind: "permanently" }),
            }
          : { label: "Delete Files Too", onChoose: () => answer({ kind: "trash" }) }
      }
      box={
        sorting.length > 0
          ? { label: "Always Move to the One I Choose", checked: always, onChange: setAlways }
          : undefined
      }
      guarded={forGood}
      onDismiss={() => ask(null)}
    />
  );
}

/** Puts the question away, for tests. */
export function resetDeleteQuestion() {
  ask(null);
}

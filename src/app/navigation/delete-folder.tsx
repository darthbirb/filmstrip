import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Contents } from "../../ipc/bindings/Contents";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { deleteFolder, folderFileCount } from "../../ipc/commands";
import { Question } from "../../ui/Question";
import { libraryChanged } from "../library";
import { getPreferences, updatePreferences } from "../preferences";
import { folderStayedBanner, folderStayedLine, holdsLine } from "../undo/lines";
import { showReport } from "../undo/report-store";
import { afterAct } from "../undo/undo";
import { useIndex } from "./index-store";

/** A folder about to be deleted. */
export type Doomed = { id: number; name: string };

// The one question a folder's delete asks, drawn above the grid. DECISIONS.md "Right-click menus".
let asking: { folder: Doomed; held: number; back: HTMLElement | null } | null = null;
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
  const held = await folderFileCount(folder.id).catch(() => null);
  if (held === null) return;
  if (held === 0) return settle(folder, null, 0, sources);
  const into = getPreferences().deleteInto;
  if (sortingSources(sources).some((source) => source.id === into) && into !== undefined) {
    return settle(folder, { kind: "moveTo", sourceId: into }, held, sources);
  }
  showReport(null);
  const focused = document.activeElement;
  ask({ folder, held, back: focused instanceof HTMLElement ? focused : null });
}

/**
 * Sends the folder where its files were told to go, and says what happened: the line at the foot
 * for what went, the banner over the grid for a folder that stayed. DECISIONS.md "Undo".
 */
async function settle(
  folder: Doomed,
  contents: Contents | null,
  held: number,
  sources: readonly SourceSummary[],
) {
  const done = await deleteFolder(folder.id, contents).catch(() => null);
  if (!done) return;
  const { batch, report } = done;
  const into =
    contents?.kind === "moveTo"
      ? (sources.find((source) => source.id === contents.sourceId)?.title ?? null)
      : null;
  if (report.deleted) {
    if (batch) afterAct(batch);
    showReport(null);
  } else {
    const carried = batch?.files ?? 0;
    if (batch) afterAct(batch, 0, folderStayedLine(folder.name, carried, held, into));
    showReport({
      sentence: folderStayedBanner(folder.name, carried, held, into),
      rows: report.refused,
      retry: () => void settle(folder, contents, held - carried, sources),
    });
  }
  await libraryChanged();
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

function Asked({ folder, held, back }: NonNullable<typeof asking>) {
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
    void settle(folder, contents, held, every);
  };

  return (
    <Question
      sentence={holdsLine(folder.name, held)}
      choices={sorting.map((source) => ({
        id: String(source.id),
        label: `Move Files to ${source.title}`,
        short: source.title,
        onChoose: () => answer({ kind: "moveTo", sourceId: source.id }),
      }))}
      choiceGlyph="sortingBox"
      fold="Move Files to…"
      last={{ label: "Delete Files Too", onChoose: () => answer({ kind: "trash" }) }}
      box={
        sorting.length > 0
          ? { label: "Always Move to the One I Choose", checked: always, onChange: setAlways }
          : undefined
      }
      onDismiss={() => ask(null)}
    />
  );
}

/** Puts the question away, for tests. */
export function resetDeleteQuestion() {
  ask(null);
}

import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import type { Copied } from "../../ipc/bindings/Copied";
import type { CopyRefusal } from "../../ipc/bindings/CopyRefusal";
import type { CopyStart } from "../../ipc/bindings/CopyStart";
import type { Progress } from "../../ipc/bindings/Progress";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import type { Stayed } from "../../ipc/bindings/Stayed";
import { dropFiles, pasteFiles } from "../../ipc/commands";
import type { MenuAnchor } from "../../ui/Menu";
import { libraryChanged } from "../library";
import { type FootNews, sayOnce, setNews } from "../navigation/foot-slot";
import { actLine, copiedBannerLine, copyCancelledLine } from "../undo/lines";
import { showReport } from "../undo/report-store";
import { afterAct } from "../undo/undo";
import { counted } from "./clipboard";

// Files brought in from Explorer, by a paste or a drop: always a copy, as a job whose line is at
// the foot, ending in the Line and Undo. DECISIONS.md "Bringing files in".

/** Where a copy goes: a folder, named as navigation names it. */
export type Into = { id: number; title: string };

/** Copies what the clipboard holds into a folder. */
export async function pasteInto(to: Into) {
  answer(await pasteFiles(to.id).catch(() => null), "paste");
}

/** Copies what was dropped from Explorer into a folder. */
export async function dropInto(to: Into, paths: readonly string[]) {
  answer(await dropFiles(to.id, [...paths]).catch(() => null), "drop");
}

/** A copy that starts says so at the foot as it runs; one refused whole says why in the band. */
function answer(start: CopyStart | null, how: "paste" | "drop") {
  if (start?.kind === "empty" && how === "paste") sayNoFiles();
  if (start?.kind === "refused") setNews(refusal(start.why, how));
}

/** Ctrl+V with nothing to paste, said once in the slot. */
export function sayNoFiles() {
  sayOnce({ kind: "noFiles" });
}

/** The band's words for a copy refused whole, as each row says it to a drop. */
export function refusal(why: CopyRefusal, how: "paste" | "drop"): FootNews {
  switch (why.kind) {
    case "alreadyIn": {
      const own = why.place.endsWith("s") ? `${why.place}’` : `${why.place}’s`;
      const one = why.carried.files + why.carried.folders === 1;
      // One is named by what it is, not counted: "the file", as "the 3 files".
      const what = one ? (why.carried.folders > 0 ? "folder" : "file") : counted(why.carried);
      const detail =
        how === "paste"
          ? `The ${what} on the clipboard ${one ? "is" : "are"} ${own} own.`
          : undefined;
      return { kind: "keyRefused", line: `Already in ${why.place}.`, detail };
    }
    case "intoItself":
      return { kind: "keyRefused", line: `${why.name} cannot go inside itself.` };
    case "offline":
      return { kind: "keyRefused", line: `${why.source} is offline.` };
  }
}

/** A file or folder a copy left where it was, as a second try would carry it, and where to. */
type Again = { into: number; path: string };

/** Nothing for what is already where it would go: a second try could only refuse it again. */
function againOf(row: Stayed): Again | null {
  if (row.at.kind !== "outside" || row.reason.kind === "alreadyIn") return null;
  return { into: row.at.into, path: `${row.at.dir.replace(/[\\/]+$/, "")}\\${row.name}` };
}

/** Each one carried again into the folder it was going into, so a tree keeps its shape. */
function retryAll(again: readonly Again[], to: string) {
  const byFolder = Map.groupBy(again, (one) => one.into);
  for (const [into, rows] of byFolder) {
    void dropInto(
      { id: into, title: to },
      rows.map((one) => one.path),
    );
  }
}

/**
 * How a copy ended: the Line with Undo for what came in, and the banner for what stayed out,
 * with Retry while it lists something a second try could bring in.
 */
export async function afterCopied(copied: Copied) {
  await libraryChanged();
  const { batch, refused, whole, to } = copied;
  const came = batch?.files ?? 0;
  if (refused.length > 0) {
    const again = refused.map(againOf).filter((one): one is Again => one !== null);
    const [only] = refused;
    showReport({
      sentence: copiedBannerLine(
        came,
        whole,
        to,
        came === 0 && refused.length === 1 ? only?.name : undefined,
      ),
      rows: refused,
      retry: again.length > 0 ? () => retryAll(again, to) : undefined,
    });
  }
  // With nothing come in, the banner turns the line round and the foot says nothing.
  if (!batch) return;
  if (copied.cancelled) afterAct(batch, 0, copyCancelledLine(batch, whole));
  else afterAct(batch, whole - came, actLine(batch, whole - came));
}

/** Follows each copy: the grid reads its folder again as files land, and hears how it ended. */
export async function watchCopies() {
  const seen = new Map<number, number>();
  await listen<Progress>("job-progress", ({ payload }) => {
    const moved = payload.copies.some((one) => seen.get(one.jobId) !== one.done);
    seen.clear();
    for (const one of payload.copies) seen.set(one.jobId, one.done);
    if (moved) void libraryChanged();
  }).catch(() => undefined);
  await listen<Copied>("copy-done", ({ payload }) => void afterCopied(payload)).catch(
    () => undefined,
  );
}

/** The Sorting Box's sorting sources, each a place a copy can go. */
export function sortingPlaces(sources: readonly SourceSummary[]): Into[] {
  return sources
    .filter((source) => source.kind === "sorting")
    .map((source) => ({ id: source.rootFolderId, title: source.title }));
}

/** The Sorting Box asks which of its sources, against a row or at the pointer. */
export type Pick = {
  heading: string;
  anchor: MenuAnchor;
  places: Into[];
  onPick: (to: Into) => void;
};

let picking: Pick | null = null;
const listeners = new Set<() => void>();

export function openPick(next: Pick | null) {
  picking = next;
  for (const listener of listeners) listener();
}

export function usePick() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => picking,
  );
}

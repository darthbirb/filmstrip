import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import type { Exported } from "../../ipc/bindings/Exported";
import type { Naming } from "../../ipc/bindings/Naming";
import type { Plan } from "../../ipc/bindings/Plan";
import type { Reason } from "../../ipc/bindings/Reason";
import type { Scope } from "../../ipc/bindings/Scope";
import type { ZipPick } from "../../ipc/bindings/ZipPick";
import { exportPlan, pickExportZip, startExport } from "../../ipc/commands";
import { formatCount } from "../../lib/format";
import { type FootNews, setNews } from "../navigation/foot-slot";
import { getPlace } from "../place";
import { getPreferences, updatePreferences } from "../preferences";
import { reasonText } from "../undo/lines";
import { showReport } from "../undo/report-store";

// A branch or a set out of the library as one zip: Windows' save dialog, then the sheet, then a
// job with its line. DECISIONS.md "Exporting a zip".

const files = (n: number) => `${formatCount(n)} ${n === 1 ? "file" : "files"}`;
const Files = (n: number) => `${formatCount(n)} ${n === 1 ? "File" : "Files"}`;
const are = (n: number) => (n === 1 ? "is" : "are");

/** "Archive", "Archive and Scans", "Archive, Scans and Card". */
function named(names: readonly string[]) {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What is exported, what its zip is named after, and what the sheet will hang against. */
export type Asked = {
  scope: Scope;
  /** The zip's name before `.zip`: the folder, or the place a set was checked in. */
  name: string;
  /** A branch's folder, for the sheet's head; a set is counted alone. */
  folder?: string;
  anchor: () => HTMLElement | null;
  /** Hung under its anchor, as off a row; otherwise over it, as off the bar. */
  below?: boolean;
};

export type Ready = Extract<Plan, { kind: "ready" }>;
export type Picked = Extract<ZipPick, { kind: "picked" }>;

/** The sheet, once Windows' dialog has said where the zip goes. */
export type Sheet = {
  scope: Scope;
  heading: string;
  plan: Ready;
  zip: Picked;
  anchor: HTMLElement;
  below: boolean;
};

/** The band's words for a set wholly on drives that are away. */
export function awayLine(offline: readonly string[], count: number) {
  const these = count === 1 ? "this file" : `these ${files(count)}`;
  return `${named(offline)} ${offline.length === 1 ? "is" : "are"} offline, so ${these} cannot be exported.`;
}

/** The sheet's word for what will be skipped, said before anything is written. */
export function skippedNote({ away, whole, offline }: Ready) {
  const which = offline.length === 1 ? "which is" : "which are";
  const of =
    away === 1
      ? `1 of the ${formatCount(whole)} is`
      : `${formatCount(away)} of the ${formatCount(whole)} are`;
  return `${of} on ${named(offline)}, ${which} offline. ${away === 1 ? "It is" : "They are"} skipped.`;
}

/** A name taken where the zip would go: the app never replaces a file. */
export function takenNews({ zip, place }: { zip: string; place: string }): FootNews {
  return {
    kind: "keyRefused",
    line: "Filmstrip never replaces a file.",
    detail: `${zip} is already in ${place}.`,
  };
}

/** What a checked set's zip is named after: the place it was checked in. */
export function setName() {
  const place = getPlace();
  switch (place?.kind) {
    case "folder":
      return place.path.at(-1)?.title ?? "Export";
    case "sorting":
      return "Sorting Box";
    case "search":
      return "Search Results";
    default:
      return "Export";
  }
}

/** The checked files, against the bar's Export… or, when it has gone behind More, against More. */
export function exportChecked(itemIds: readonly number[]) {
  void exportFiles({
    scope: { kind: "files", itemIds: [...itemIds] },
    name: setName(),
    anchor: () => {
      const bar = document.querySelector('[role="toolbar"][aria-label="Selection"]');
      return (
        bar?.querySelector<HTMLElement>(':scope > [data-piece="export"] > button') ??
        bar?.querySelector<HTMLElement>(':scope > button[aria-label="More"]') ??
        null
      );
    },
  });
}

let asking = false;

/**
 * Export… : refused at once when every file is away, then Windows' save dialog, whose Yes over a
 * name that exists is refused, then the sheet against what asked.
 */
export async function exportFiles(asked: Asked) {
  if (asking) return;
  asking = true;
  try {
    const plan = await exportPlan(asked.scope).catch(() => null);
    if (!plan || plan.kind === "empty") return;
    if (plan.kind === "away") {
      setNews({ kind: "keyRefused", line: awayLine(plan.offline, plan.files) });
      return;
    }
    const pick = await pickExportZip(asked.name, getPreferences().exportDir ?? null).catch(
      () => null,
    );
    const anchor = asked.anchor();
    if (!pick || pick.kind === "cancelled") {
      anchor?.focus({ preventScroll: true });
      return;
    }
    if (pick.kind === "taken") {
      setNews(takenNews(pick));
      return;
    }
    if (!anchor) return;
    const heading = asked.folder
      ? `${asked.folder} · ${Files(plan.whole)}`
      : `Export ${Files(plan.whole)}`;
    openSheet({
      scope: asked.scope,
      heading,
      plan,
      zip: pick,
      anchor,
      below: asked.below ?? false,
    });
  } finally {
    asking = false;
  }
}

/** Export on the sheet: the job is queued, and the place and the naming kept for next time. */
export async function startSheet(sheet: Sheet, naming: Naming) {
  updatePreferences({ exportDir: sheet.zip.dir, exportNaming: naming });
  const start = await startExport(sheet.scope, naming, sheet.zip.path).catch(() => null);
  if (start?.kind === "taken") setNews(takenNews(start));
}

/** The band's second sentence for a zip that could not be written. */
function failure(reason: Reason) {
  return `${reasonText(reason)}.`;
}

/**
 * How an export ended: the Line with Show in Explorer, the banner for what was skipped, with no
 * Retry since the zip is finished, and the band for a zip that could not be put in place.
 */
export function afterExported(done: Exported) {
  const { end, zip, whole, written, skipped } = done;
  switch (end.kind) {
    case "written": {
      const left = whole - written;
      if (skipped.length > 0) {
        showReport({
          sentence: `${formatCount(written)} of ${files(whole)} went into ${zip}`,
          rows: skipped,
          skipped: true,
        });
      }
      const line =
        left > 0
          ? `Exported ${formatCount(written)} of ${files(whole)} to ${zip}. The other ${formatCount(left)} ${are(left)} in the banner.`
          : `Exported ${files(written)} to ${zip}.`;
      setNews({ kind: "exported", line, path: done.path });
      return;
    }
    case "cancelled":
      setNews({ kind: "exported", line: `Stopped exporting ${zip}. Nothing was written.` });
      return;
    case "nothing": {
      const [only] = skipped;
      const what = skipped.length === 1 && only ? only.name : `The ${files(whole)}`;
      showReport({
        sentence: `${what} could not go into ${zip}`,
        rows: skipped,
        skipped: true,
      });
      return;
    }
    case "taken":
      setNews(takenNews(done));
      return;
    case "failed":
      setNews({
        kind: "keyRefused",
        line: `${zip} could not be written. ${failure(end.reason)}`,
        path: done.dir,
      });
  }
}

/** Hears each export end. */
export async function watchExports() {
  await listen<Exported>("export-done", ({ payload }) => afterExported(payload)).catch(
    () => undefined,
  );
}

let open: Sheet | null = null;
const listeners = new Set<() => void>();

export function openSheet(next: Sheet | null) {
  open = next;
  for (const listener of listeners) listener();
}

export function useSheet() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => open,
  );
}

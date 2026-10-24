import { type CSSProperties, useId, useLayoutEffect, useRef, useState } from "react";

import type { Copying } from "../../ipc/bindings/Copying";
import type { Exporting } from "../../ipc/bindings/Exporting";
import type { LibraryTotals } from "../../ipc/bindings/LibraryTotals";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import type { Tally } from "../../ipc/bindings/Tally";
import { cancelCopy, cancelExport, revealPath } from "../../ipc/commands";
import { formatBytes, formatCount, formatShortDay } from "../../lib/format";
import { Band } from "../../ui/Band";
import { Bar } from "../../ui/Bar";
import { Button } from "../../ui/Button";
import { FirstFit } from "../../ui/FirstFit";
import { Glyph } from "../../ui/Glyph";
import { GlyphButton } from "../../ui/GlyphButton";
import { Line } from "../../ui/Line";
import { keepEscape, SURFACE } from "../../ui/Menu";
import { PushDown } from "../../ui/PushDown";
import { Tallies, type TallyNote, type TallyRow } from "../../ui/Tallies";
import { undo } from "../undo/undo";
import { refusalSentence } from "./add-source";
import { type FootNews, setNews, useNews } from "./foot-slot";
import { useIndex } from "./index-store";
import { useWork } from "./work-store";

/** The panel's baseline and, above it, the walk in progress. DECISIONS.md "Background work". */
export function Foot({ rail = false }: { rail?: boolean }) {
  const { progress } = useWork();
  const news = useNews();
  const anchor = `--foot-${useId().replace(/[^\w-]/g, "")}`;
  // Folded, a line that has been answered leaves: the grid is what shows the files are back.
  const shown =
    news !== null &&
    !(
      rail &&
      (news.kind === "undone" || news.kind === "said" || (news.kind === "exported" && !news.path))
    );

  // Newest highest, above the walk, as the foot is ordered by permanence from the bottom.
  const jobs: Job[] = [
    ...(progress?.copies ?? []).map((copy) => ({ kind: "copy" as const, ...copy })),
    ...(progress?.exports ?? []).map((one) => ({ kind: "export" as const, ...one })),
  ].sort((a, b) => b.jobId - a.jobId);
  const left = progress ? progress.pending + progress.running : 0;
  const busy = progress !== null && progress.phase !== "idle";
  const done = progress?.completed ?? 0;
  const percent = done + left > 0 ? Math.round((done / (done + left)) * 100) : 0;

  return (
    // Ordered by permanence from the bottom: the count, the walk, then what waits to be read.
    <div className="w-full shrink-0" style={{ anchorName: anchor } as CSSProperties}>
      <PushDown open={shown}>{shown && <News news={news} rail={rail} />}</PushDown>
      {jobs.map((job) =>
        job.kind === "copy" ? (
          <CopyLine key={job.jobId} copy={job} rail={rail} />
        ) : (
          <ExportLine key={job.jobId} job={job} rail={rail} />
        ),
      )}
      <PushDown open={busy}>
        {rail ? (
          <div className="border-line border-t px-1.5 pt-2 pb-1.5">
            <Bar percent={percent} />
          </div>
        ) : (
          <div className="flex flex-col gap-1 border-line border-t px-2.5 pt-2 pb-1.5">
            <span className="flex items-baseline gap-2 text-fg-mid text-small">
              <span className="min-w-0 flex-1 truncate tabular-nums">
                Indexing {formatCount(left)}…
              </span>
              <span className="text-fg tabular-nums">{percent}%</span>
            </span>
            <Bar percent={percent} />
          </div>
        )}
      </PushDown>
      <Baseline rail={rail} anchor={anchor} />
    </div>
  );
}

/** A copy's or an export's line, by the job that runs it. */
type Job = (Copying & { kind: "copy" }) | (Exporting & { kind: "export" });

const NONE: Tally = { count: 0, bytes: 0 };
const NOTHING: LibraryTotals = {
  pictures: NONE,
  videos: NONE,
  other: NONE,
  all: NONE,
  sorting: NONE,
  trash: NONE,
};

/** The library's line, each wording giving up a whole part: "items", then the size. */
function wordings({ count, bytes }: Tally) {
  const figure = formatCount(count);
  const items = `${figure} ${count === 1 ? "item" : "items"}`;
  if (count === 0) return [items, figure];
  const size = formatBytes(bytes);
  return [`${items} · ${size}`, `${figure} · ${size}`, figure];
}

/**
 * What the library holds and weighs, opening its totals above the foot, or beside the rail when
 * folded. DECISIONS.md "Navigation".
 */
function Baseline({ rail, anchor }: { rail: boolean; anchor: string }) {
  const { sources, totals } = useIndex();
  const id = useId();
  const own = `--baseline-${id.replace(/[^\w-]/g, "")}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [fit, setFit] = useState(0);
  const texts = wordings((totals ?? NOTHING).all);
  const whole = texts[0] ?? "";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={whole}
        title={rail || fit > 0 ? whole : "Library · what it holds"}
        style={rail ? ({ anchorName: own } as CSSProperties) : undefined}
        className={`focus-ring-inset flex h-foot w-full items-center border-line border-t text-small transition-colors duration-(--motion-quick) motion-reduce:transition-none ${rail ? "justify-center" : "gap-2 px-2.5 text-left"} ${open ? "bg-raised text-fg-mid" : "text-fg-dim hover:bg-wash hover:text-fg-mid"}`}
      >
        <Glyph name="source" className="text-glyph" />
        {!rail && <FirstFit texts={texts} onFit={setFit} className="flex-1 tabular-nums" />}
      </button>
      <div
        ref={surface}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Library"
        tabIndex={-1}
        onToggle={(event) => {
          const opened = event.newState === "open";
          setOpen(opened);
          if (opened) surface.current?.focus();
          else if (
            surface.current?.contains(document.activeElement) ||
            document.activeElement === document.body
          )
            trigger.current?.focus();
        }}
        onKeyDown={keepEscape}
        style={
          (rail
            ? { positionAnchor: own, left: "anchor(right)", bottom: "anchor(bottom)" }
            : {
                positionAnchor: anchor,
                left: "anchor(left)",
                bottom: "anchor(top)",
                positionTryFallbacks: "flip-block",
              }) as CSSProperties
        }
        className={`${rail ? "ml-tile-gap" : "mb-tile-gap"} outline-none ${SURFACE}`}
      >
        {open && <Totals totals={totals ?? NOTHING} sources={sources ?? []} />}
      </div>
    </>
  );
}

/** By kind, then what waits and what is thrown away, then the sources, any that is away named. */
function Totals({ totals, sources }: { totals: LibraryTotals; sources: readonly SourceSummary[] }) {
  const size = (tally: Tally) => (tally.count > 0 ? formatBytes(tally.bytes) : undefined);
  const row = (label: string, tally: Tally, sum = false): TallyRow => ({
    label,
    count: tally.count,
    trail: size(tally),
    sum,
  });
  const away = sources.filter((source) => !source.reachable);
  const groups: TallyRow[][] = [
    [
      row("Pictures", totals.pictures),
      row("Videos", totals.videos),
      ...(totals.other.count > 0 ? [row("Other", totals.other)] : []),
      row("In All", totals.all, true),
    ],
    [row("Sorting Box", totals.sorting), row("Trash", totals.trash)],
    [
      {
        label: "Sources",
        count: sources.length,
        trail: away.length > 0 ? `${formatCount(away.length)} offline` : undefined,
      },
    ],
  ];
  return <Tallies heading="Library" groups={groups} notes={away.map(offlineNote)} />;
}

/** A source that is away is still counted, from what the index last read of it. */
function offlineNote(source: SourceSummary): TallyNote {
  const held = source.itemCount;
  if (held === 0) return { key: source.id, text: `${source.title} is offline` };
  const when = source.indexedAt === null ? "" : `, ${formatShortDay(source.indexedAt)}`;
  return {
    key: source.id,
    text: `${source.title} is offline · its ${formatCount(held)} ${held === 1 ? "is" : "are"} counted from the last walk${when}`,
  };
}

/** The slot's one piece of news: a refusal, or what an act or an undo did. DECISIONS.md "Undo". */
function News({ news, rail }: { news: FootNews; rail: boolean }) {
  const dismiss = () => setNews(null);
  if (news.kind === "refused") {
    const { why, clash, path } = news.refused;
    return <Band sentence={refusalSentence(why, clash)} path={path} onDismiss={dismiss} />;
  }
  if (news.kind === "keyRefused") {
    return <Band sentence={news.line} detail={news.detail} path={news.path} onDismiss={dismiss} />;
  }
  const exported = news.kind === "exported" ? news : null;
  const reveal = exported?.path;

  if (rail) {
    return (
      <div className="grid place-items-center border-line border-t py-1.5">
        {news.kind === "done" ? (
          <GlyphButton
            glyph="undo"
            label={`Undo · ${news.line} · Ctrl+Z`}
            onClick={() => void undo(news.batchId)}
          />
        ) : reveal ? (
          <GlyphButton
            glyph="folderOpen"
            label={`Show in Explorer · ${exported?.line}`}
            onClick={() => void revealPath(reveal).catch(() => undefined)}
          />
        ) : (
          <Nothing noFiles={news.kind === "noFiles"} />
        )}
      </div>
    );
  }
  if (news.kind === "done") {
    return (
      <Line
        glyph="done"
        sentence={news.line}
        action={
          <Button glyph="undo" title="Undo · Ctrl+Z" onClick={() => void undo(news.batchId)}>
            Undo
          </Button>
        }
        onDismiss={dismiss}
      />
    );
  }
  if (news.kind === "exported") {
    return (
      <Line
        glyph="done"
        sentence={news.line}
        action={
          reveal && (
            <Button
              glyph="folderOpen"
              onClick={() => void revealPath(reveal).catch(() => undefined)}
            >
              Show in Explorer
            </Button>
          )
        }
        onDismiss={dismiss}
      />
    );
  }
  if (news.kind === "noFiles") {
    return <Line glyph="paste" sentence={NO_FILES} onDismiss={dismiss} />;
  }
  if (news.kind === "said") {
    return <Line glyph="done" sentence={news.line} onDismiss={dismiss} />;
  }
  return (
    <Line
      glyph="undo"
      sentence={news.kind === "undone" ? news.line : "Nothing to undo."}
      onDismiss={dismiss}
    />
  );
}

const NO_FILES = "The clipboard holds no files.";

/** Folded, the rail has no room for the sentence, so it comes out beside the slot. */
function Nothing({ noFiles = false }: { noFiles?: boolean }) {
  const line = useRef<HTMLDivElement>(null);
  const anchor = `--nothing-${useId().replace(/[^\w-]/g, "")}`;
  // The top layer escapes the folded face's hiding, so it shows only while the rail is the face shown.
  useLayoutEffect(() => {
    if (!line.current?.closest("[inert]")) line.current?.showPopover();
  }, []);
  return (
    <span
      style={{ anchorName: anchor } as CSSProperties}
      className="grid size-control place-items-center text-fg-dim text-icon"
    >
      <Glyph name={noFiles ? "paste" : "undo"} />
      <div
        ref={line}
        popover="manual"
        style={
          { positionAnchor: anchor, left: "anchor(right)", top: "anchor(top)" } as CSSProperties
        }
        className="m-0 ml-1.5 flex h-control items-center whitespace-nowrap rounded-control border-0 bg-panel px-2.5 text-fg text-ui shadow-overlay inset-ring inset-ring-line-control"
      >
        {noFiles ? NO_FILES : "Nothing to undo."}
      </div>
    </span>
  );
}

/**
 * A copy's own line, the walk's shape: where it is going, how far, and its dismiss, which cancels
 * it after the file in hand. Artboards › Bringing files in.
 */
function CopyLine({ copy, rail }: { copy: Copying; rail: boolean }) {
  const percent = copy.whole > 0 ? Math.round((copy.done / copy.whole) * 100) : 0;
  const left = `Copying to ${copy.to} · ${formatCount(copy.whole - copy.done)} of ${formatCount(copy.whole)} left`;
  if (rail) {
    return (
      <div title={left} className="border-line border-t px-1.5 pt-2 pb-1.5">
        <Bar percent={percent} />
      </div>
    );
  }
  return (
    <div title={left} className="flex flex-col gap-1 border-line border-t py-1.5 pr-1.5 pl-2.5">
      <span className="flex items-center gap-2 text-fg-mid text-small">
        <span className="min-w-0 flex-1 truncate">Copying to {copy.to}…</span>
        <span className="text-fg tabular-nums">{percent}%</span>
        <GlyphButton
          glyph="close"
          label="Cancel Copy"
          onClick={() => void cancelCopy(copy.jobId).catch(() => false)}
        />
      </span>
      <span className="pr-1">
        <Bar percent={percent} />
      </span>
    </div>
  );
}

/**
 * An export's own line, as a copy's: the zip it is writing, how far, and its dismiss, which
 * cancels it and leaves no zip. Artboards › Exporting a zip.
 */
function ExportLine({ job, rail }: { job: Exporting; rail: boolean }) {
  const percent = job.whole > 0 ? Math.round((job.done / job.whole) * 100) : 0;
  const left = `Exporting to ${job.path} · ${formatCount(job.whole - job.done)} of ${formatCount(job.whole)} left`;
  if (rail) {
    return (
      <div title={left} className="border-line border-t px-1.5 pt-2 pb-1.5">
        <Bar percent={percent} />
      </div>
    );
  }
  return (
    <div title={left} className="flex flex-col gap-1 border-line border-t py-1.5 pr-1.5 pl-2.5">
      <span className="flex items-center gap-2 text-fg-mid text-small">
        <span className="min-w-0 flex-1 truncate">Exporting {job.zip}…</span>
        <span className="text-fg tabular-nums">{percent}%</span>
        <GlyphButton
          glyph="close"
          label="Cancel Export"
          onClick={() => void cancelExport(job.jobId).catch(() => false)}
        />
      </span>
      <span className="pr-1">
        <Bar percent={percent} />
      </span>
    </div>
  );
}

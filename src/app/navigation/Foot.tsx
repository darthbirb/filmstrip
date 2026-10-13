import { type CSSProperties, useId, useLayoutEffect, useRef, useState } from "react";

import type { LibraryTotals } from "../../ipc/bindings/LibraryTotals";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import type { Tally } from "../../ipc/bindings/Tally";
import { formatBytes, formatCount, formatShortDay } from "../../lib/format";
import { Band } from "../../ui/Band";
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
  const shown = news !== null && !(rail && news.kind === "undone");

  const left = progress ? progress.pending + progress.running : 0;
  const busy = progress !== null && progress.phase !== "idle";
  const done = progress?.completed ?? 0;
  const percent = done + left > 0 ? Math.round((done / (done + left)) * 100) : 0;

  return (
    // Ordered by permanence from the bottom: the count, the walk, then what waits to be read.
    <div className="w-full shrink-0" style={{ anchorName: anchor } as CSSProperties}>
      <PushDown open={shown}>{shown && <News news={news} rail={rail} />}</PushDown>
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
    return <Band sentence={news.line} detail={news.detail} onDismiss={dismiss} />;
  }
  if (rail) {
    return (
      <div className="grid place-items-center border-line border-t py-1.5">
        {news.kind === "done" ? (
          <GlyphButton
            glyph="undo"
            label={`Undo · ${news.line} · Ctrl+Z`}
            onClick={() => void undo(news.batchId)}
          />
        ) : (
          <Nothing />
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
  return (
    <Line
      glyph="undo"
      sentence={news.kind === "undone" ? news.line : "Nothing to undo."}
      onDismiss={dismiss}
    />
  );
}

/** Folded, the rail has no room for the sentence, so it comes out beside the slot. */
function Nothing() {
  const line = useRef<HTMLDivElement>(null);
  const anchor = `--nothing-${useId().replace(/[^\w-]/g, "")}`;
  useLayoutEffect(() => {
    line.current?.showPopover();
  }, []);
  return (
    <span
      style={{ anchorName: anchor } as CSSProperties}
      className="grid size-control place-items-center text-fg-dim text-icon"
    >
      <Glyph name="undo" />
      <div
        ref={line}
        popover="manual"
        style={
          { positionAnchor: anchor, left: "anchor(right)", top: "anchor(top)" } as CSSProperties
        }
        className="m-0 ml-1.5 flex h-control items-center whitespace-nowrap rounded-control border-0 bg-panel px-2.5 text-fg text-ui shadow-overlay inset-ring inset-ring-line-control"
      >
        Nothing to undo.
      </div>
    </span>
  );
}

/** How far along the walk is. Pewter, because progress states a fact rather than raising an alarm. */
function Bar({ percent }: { percent: number }) {
  return (
    <span className="block h-progress overflow-hidden rounded-full bg-raised">
      <span
        className="block h-full bg-plate transition-[width] duration-(--motion-size) ease-out motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

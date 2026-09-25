import { type CSSProperties, useId, useLayoutEffect, useRef } from "react";

import { formatCount } from "../../lib/format";
import { Band } from "../../ui/Band";
import { Button } from "../../ui/Button";
import { Glyph } from "../../ui/Glyph";
import { GlyphButton } from "../../ui/GlyphButton";
import { Line } from "../../ui/Line";
import { PushDown } from "../../ui/PushDown";
import { undo } from "../undo/undo";
import { refusalSentence } from "./add-source";
import { type FootNews, setNews, useNews } from "./foot-slot";
import { useIndex } from "./index-store";
import { useWork } from "./work-store";

/** The panel's baseline and, above it, the walk in progress. DECISIONS.md "Background work". */
export function Foot({ rail = false }: { rail?: boolean }) {
  const { sources } = useIndex();
  const { progress } = useWork();
  const news = useNews();
  // Folded, a line that has been answered leaves: the grid is what shows the files are back.
  const shown = news !== null && !(rail && news.kind === "undone");
  const held = (sources ?? []).reduce((sum, source) => sum + source.itemCount, 0);
  const count = sources?.length ?? 0;
  const totals = `${formatCount(held)} items · ${formatCount(count)} ${count === 1 ? "source" : "sources"}`;

  const left = progress ? progress.pending + progress.running : 0;
  const busy = progress !== null && progress.phase !== "idle";
  const done = progress?.completed ?? 0;
  const percent = done + left > 0 ? Math.round((done / (done + left)) * 100) : 0;

  return (
    // Ordered by permanence from the bottom: the count, the walk, then what waits to be read.
    <div className="shrink-0">
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
      <div
        title={rail ? totals : undefined}
        className={`flex h-foot items-center border-line border-t text-fg-dim text-small ${rail ? "justify-center" : "gap-2 px-2.5"}`}
      >
        <Glyph name="source" className="text-glyph" />
        {!rail && <span className="min-w-0 flex-1 truncate tabular-nums">{totals}</span>}
      </div>
    </div>
  );
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

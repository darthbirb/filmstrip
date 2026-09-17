import { formatCount } from "../../lib/format";
import { Band } from "../../ui/Band";
import { Glyph } from "../../ui/Glyph";
import { PushDown } from "../../ui/PushDown";
import { refusalSentence } from "./add-source";
import { useIndex } from "./index-store";
import { setRefused, useRefused } from "./refusal-store";
import { useWork } from "./work-store";

/** The panel's baseline and, above it, the walk in progress. DECISIONS.md "Background work". */
export function Foot({ rail = false }: { rail?: boolean }) {
  const { sources } = useIndex();
  const { progress } = useWork();
  const refused = useRefused();
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
      <PushDown open={refused !== null}>
        {refused && (
          <Band
            sentence={refusalSentence(refused.why, refused.clash)}
            path={refused.path}
            onDismiss={() => setRefused(null)}
          />
        )}
      </PushDown>
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

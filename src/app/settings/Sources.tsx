import { useEffect, useRef, useState } from "react";

import type { SourceKind } from "../../ipc/bindings/SourceKind";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { removeSource, renameSource, revealSource, setSourceKind } from "../../ipc/commands";
import { formatCount } from "../../lib/format";
import { Band } from "../../ui/Band";
import { EmptyState } from "../../ui/EmptyState";
import { Glyph } from "../../ui/Glyph";
import { GlyphButton } from "../../ui/GlyphButton";
import { Segmented } from "../../ui/Segmented";
import { addFolder, refusalSentence } from "../navigation/add-source";
import { loadIndex, useIndex } from "../navigation/index-store";
import { setRefused, useRefused } from "../navigation/refusal-store";
import { useWork } from "../navigation/work-store";

const KINDS: readonly { value: SourceKind; label: string }[] = [
  { value: "library", label: "Library" },
  { value: "sorting", label: "Sorting" },
];

const ADD =
  "focus-ring flex h-control items-center gap-1.5 rounded-control bg-raised px-2.5 text-fg text-ui inset-ring inset-ring-line-control transition-colors duration-(--motion-quick) hover:bg-raised-hi motion-reduce:transition-none";

/** Every folder the app reads, and the two things only a source has. DECISIONS.md "Places, not queries". */
export function Sources() {
  const { sources } = useIndex();
  const refused = useRefused();
  const held = sources ?? [];

  return (
    <div className="flex flex-col gap-2">
      {held.length === 0 ? (
        <div className="rounded-control bg-inset py-6 inset-ring inset-ring-line-control">
          <EmptyState
            glyph="folders"
            title="No Sources Yet"
            note="Add a folder and Filmstrip will read it where it stands."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {held.map((source) => (
            <Row key={source.id} source={source} />
          ))}
        </div>
      )}
      {refused && (
        <Band
          sentence={refusalSentence(refused.why, refused.clash)}
          path={refused.path}
          onDismiss={() => setRefused(null)}
        />
      )}
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={() => void addFolder("library")} className={ADD}>
          <Glyph name="plus" className="text-fg-dim text-glyph" />
          Add a folder…
        </button>
        <span className="text-fg-dim text-small">Added here, a folder is a library source.</span>
      </div>
      <p className="m-0 text-fg-dim text-small">
        Removing a source leaves its folder on disk and drops what Filmstrip knows about it,
        including the tags and notes on its files.
      </p>
    </div>
  );
}

function Row({ source }: { source: SourceSummary }) {
  const { progress } = useWork();
  const [naming, setNaming] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // Clicking the name turns it into a field, so the keyboard has to follow it there.
  useEffect(() => {
    if (naming) field.current?.select();
  }, [naming]);
  const walking = progress !== null && progress.phase !== "idle";
  const left = progress ? progress.pending + progress.running : 0;
  const done = progress?.completed ?? 0;
  const percent = done + left > 0 ? Math.round((done / (done + left)) * 100) : 0;

  const rename = async (title: string) => {
    setNaming(false);
    if (title.trim() && title.trim() !== source.title) {
      await renameSource(source.id, title.trim()).catch(() => undefined);
      await loadIndex().catch(() => undefined);
    }
  };

  return (
    <div className="flex flex-col gap-1 rounded-control bg-inset px-2.5 py-2 inset-ring inset-ring-line-control">
      <div className="flex items-center gap-2">
        <Glyph name="source" filled className="shrink-0 text-fg-dim text-icon" />
        {naming ? (
          <input
            // The app's own label for it, not the folder's name on disk. DESIGN.md "Shapes".
            ref={field}
            aria-label={`Rename ${source.title}`}
            defaultValue={source.title}
            onBlur={(event) => void rename(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void rename(event.currentTarget.value);
              if (event.key === "Escape") setNaming(false);
            }}
            className="focus-ring h-control min-w-0 flex-1 rounded-nested bg-ground px-1.5 text-fg text-ui inset-ring inset-ring-line-control"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            title="Rename"
            className="focus-ring min-w-0 flex-1 truncate rounded-nested px-1 text-left text-fg text-ui hover:bg-wash"
          >
            {source.title}
          </button>
        )}
        <span className="flex shrink-0 items-baseline gap-2 text-fg-mid text-small tabular-nums">
          {walking ? (
            <>
              Indexing {formatCount(left)}…<span className="text-fg">{percent}%</span>
            </>
          ) : (
            `${formatCount(source.itemCount)} items`
          )}
        </span>
        {/* A kind has nothing to move while the walk is still finding out what is in the folder. */}
        {!walking && (
          <Segmented
            label={`Kind of ${source.title}`}
            options={KINDS}
            value={source.kind}
            onChange={(kind) => {
              void setSourceKind(source.id, kind)
                .then(() => loadIndex())
                .catch(() => undefined);
            }}
          />
        )}
        {source.reachable && (
          <GlyphButton
            glyph="folderOpen"
            label={`Reveal ${source.title}`}
            onClick={() => void revealSource(source.id).catch(() => undefined)}
          />
        )}
        <GlyphButton
          glyph="minusCircle"
          label={`Remove ${source.title}`}
          onClick={() => {
            void removeSource(source.id)
              .then(() => loadIndex())
              .catch(() => undefined);
          }}
        />
      </div>
      <span className="truncate pl-7 font-mono text-eyebrow text-fg-dim" title={source.root}>
        {source.root}
        {!source.reachable && " · offline"}
      </span>
    </div>
  );
}

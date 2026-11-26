import { useEffect, useRef, useState } from "react";

import type { SourceKind } from "../../ipc/bindings/SourceKind";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { removeSource, renameSource, revealSource, setSourceKind } from "../../ipc/commands";
import { files, formatCount } from "../../lib/format";
import { Band } from "../../ui/Band";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { EmptyState } from "../../ui/EmptyState";
import { Glyph } from "../../ui/Glyph";
import { GlyphButton } from "../../ui/GlyphButton";
import { Segmented } from "../../ui/Segmented";
import { failed, unasked } from "../failure";
import { libraryChanged } from "../library";
import { addFolder, refusalSentence } from "../navigation/add-source";
import { loadIndex, useIndex } from "../navigation/index-store";
import { setRefused, useRefused } from "../navigation/refusal-store";
import { useWork } from "../navigation/work-store";
import { updatePreferences, usePreferences } from "../preferences";
import { shownFailed, whyFailed } from "../undo/lines";
import { settleLine } from "../undo/undo";
import { Caption, Rows } from "./Rows";
import { binStays } from "./recycle-words";
import {
  finishRemove,
  type RemoveEnd,
  settingsHeld,
  startRemove,
  useRemove,
} from "./settings-store";

const KINDS: readonly { value: SourceKind; label: string }[] = [
  { value: "library", label: "Library" },
  { value: "sorting", label: "Sorting" },
];

/** Every folder the app reads, and the two things only a source has. DECISIONS.md "Places, not queries". */
export function Sources({ asking }: { asking?: number }) {
  const { sources } = useIndex();
  const refused = useRefused();
  const { ended } = useRemove();
  const held = sources ?? [];
  useEffect(() => {
    if (refused) finishRemove(null);
  }, [refused]);

  return (
    <div className="flex flex-col gap-2">
      {held.length === 0 ? (
        <div className="rounded-control bg-inset py-6 inset-ring inset-ring-line-control">
          <EmptyState glyph="folders" title="No Sources Yet" />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {held.map((source) => (
            <Row key={source.id} source={source} asking={source.id === asking} />
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
      {!refused && ended && <Band sentence={ended.sentence} onDismiss={() => finishRemove(null)} />}
      <div className="flex gap-1.5">
        <Button glyph="plus" onClick={() => void addFolder("library")}>
          Add Source…
        </Button>
        <Button glyph="plus" onClick={() => void addFolder("sorting")}>
          Add Sorting Source…
        </Button>
      </div>
      <DeleteDefault sources={held} />
    </div>
  );
}

const kindFailed = (title: string, kind: SourceKind) =>
  `Could not make ${title} a ${kind === "library" ? "library" : "sorting"} source.`;

const ASK = "ask";

/**
 * Where a deleted folder's files go without asking. It lives with the sorting sources it names,
 * so a sorting source removed takes its default with it. DECISIONS.md "Right-click menus".
 */
function DeleteDefault({ sources }: { sources: readonly SourceSummary[] }) {
  const { deleteInto } = usePreferences();
  const sorting = sources.filter((source) => source.kind === "sorting");
  if (sorting.length === 0) return null;
  const value = sorting.some((source) => source.id === deleteInto) ? String(deleteInto) : ASK;
  const options = [
    { value: ASK, label: "Ask Each Time" },
    ...sorting.map((source) => ({
      value: String(source.id),
      label: source.title,
      glyph: "sortingBox" as const,
    })),
  ];
  const control = (
    <Dropdown
      label="Move Its Files To"
      align="end"
      options={options}
      value={value}
      onChange={(next) =>
        updatePreferences({ deleteInto: next === ASK ? undefined : Number(next) })
      }
    />
  );
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Caption>Deleting a Folder</Caption>
      <Rows rows={[{ label: "Move Its Files To", control }]} />
    </div>
  );
}

function Row({ source, asking: opened }: { source: SourceSummary; asking: boolean }) {
  const [asking, setAsking] = useState(opened);
  return asking ? (
    <Asking source={source} onCancel={() => setAsking(false)} />
  ) : (
    <Settled source={source} onRemove={() => setAsking(true)} />
  );
}

function Settled({ source, onRemove }: { source: SourceSummary; onRemove: () => void }) {
  const { progress } = useWork();
  const [naming, setNaming] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // Clicking the name turns it into a field, so the keyboard has to follow it there.
  useEffect(() => {
    if (naming) field.current?.select();
  }, [naming]);
  const walking = progress?.walkedSource === source.id;
  const left = progress ? progress.pending + progress.running : 0;
  const done = progress?.completed ?? 0;
  const percent = done + left > 0 ? Math.round((done / (done + left)) * 100) : 0;

  const rename = async (title: string) => {
    setNaming(false);
    if (title.trim() && title.trim() !== source.title) {
      await renameSource(source.id, title.trim()).catch(
        failed(`Could not rename ${source.title}.`),
      );
      await loadIndex().catch(unasked);
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
            files(source.itemCount)
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
                .catch(failed(kindFailed(source.title, kind)));
            }}
          />
        )}
        {source.reachable ? (
          <GlyphButton
            glyph="folderOpen"
            label={`Show ${source.title} in Explorer`}
            onClick={() => void revealSource(source.id).catch(failed(shownFailed(source.title)))}
          />
        ) : (
          <span aria-hidden className="size-control shrink-0" />
        )}
        <GlyphButton
          glyph="minusCircle"
          label={`Remove ${source.title}`}
          danger
          onClick={onRemove}
        />
      </div>
      <span className="truncate pl-7 font-mono text-eyebrow text-fg-dim" title={source.root}>
        {source.root}
        {!source.reachable && " · offline"}
      </span>
    </div>
  );
}

/**
 * The warning, at the moment it matters and on the row it is about: the name and the count stay,
 * so the question says which source it means. Escape puts the row back and leaves Settings open.
 */
function Asking({ source, onCancel }: { source: SourceSummary; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const { removing } = useRemove();
  const here = removing === source.id;
  const stays = binStays(source.trashCount);
  // The remove button that had the focus has just gone, so the focus goes to the answer that keeps.
  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <fieldset
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (!here) onCancel();
      }}
      className="m-0 flex min-w-0 flex-col gap-1.5 rounded-control border-0 bg-inset px-2.5 py-2 inset-ring inset-ring-line-danger"
    >
      <legend className="sr-only">Remove {source.title}?</legend>
      <div className="flex items-center gap-2">
        <Glyph name="warning" className="shrink-0 text-danger text-icon" />
        <span className="min-w-0 flex-1 truncate px-1 text-fg text-ui">{source.title}</span>
        <span className="shrink-0 text-fg-mid text-small tabular-nums">
          {files(source.itemCount)}
        </span>
      </div>
      <p className="m-0 pl-7 text-fg-mid text-small">
        The folder stays on disk. Its tags and notes are lost.
        {stays && (
          <>
            {" "}
            Its <span className="text-fg">{stays.files}</span> {stays.verb} there, out of the app.
          </>
        )}
      </p>
      <div className="flex gap-1.5 pl-7">
        <Button
          tone="danger"
          onClick={() => {
            void removeNow(source, onCancel);
          }}
        >
          Remove Source
        </Button>
        <Button ref={cancel} tone="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * Forgets a source, its files in the Recycle Bin left there, run outside the row so Settings holds
 * still meanwhile; one that fails puts its row back. Artboards › Sources.
 */
async function removeNow(source: SourceSummary, onKept: () => void) {
  if (settingsHeld()) return;
  setRefused(null);
  startRemove(source.id);
  let ended: RemoveEnd | null = null;
  try {
    await removeSource(source.id);
  } catch (error) {
    ended = { sentence: `${source.title} was not removed. ${whyFailed(error)}` };
  }
  await libraryChanged().catch(unasked);
  if (ended) onKept();
  else await settleLine();
  finishRemove(ended);
}

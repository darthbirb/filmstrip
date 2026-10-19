import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import type { SourceKind } from "../../ipc/bindings/SourceKind";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { removeSource, renameSource, revealSource, setSourceKind } from "../../ipc/commands";
import { formatCount } from "../../lib/format";
import { Band } from "../../ui/Band";
import { Bar } from "../../ui/Bar";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { EmptyState } from "../../ui/EmptyState";
import { Glyph } from "../../ui/Glyph";
import { GlyphButton } from "../../ui/GlyphButton";
import { Segmented } from "../../ui/Segmented";
import { libraryChanged } from "../library";
import { addFolder, refusalSentence } from "../navigation/add-source";
import { loadIndex, useIndex } from "../navigation/index-store";
import { setRefused, useRefused } from "../navigation/refusal-store";
import { useWork } from "../navigation/work-store";
import { updatePreferences, usePreferences } from "../preferences";
import { whyFailed } from "./backup-words";
import { Caption, Rows } from "./Rows";
import { notRemoved, trashGoes } from "./recycle-words";
import {
  finishRemove,
  type RemoveEnd,
  removeProgress,
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
  // There is only ever one band: a folder refused since takes the remove's place.
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
      {!refused && ended && (
        <Band sentence={ended.sentence} path={ended.path} onDismiss={() => finishRemove(null)} />
      )}
      <div className="flex">
        <Button glyph="plus" onClick={() => void addFolder("library")}>
          Add Source…
        </Button>
      </div>
      <DeleteDefault sources={held} />
    </div>
  );
}

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
            label={`Show ${source.title} in Explorer`}
            onClick={() => void revealSource(source.id).catch(() => undefined)}
          />
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
  const here = removing?.id === source.id ? removing : null;
  const goes = trashGoes(source.trashCount);
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
          {formatCount(source.itemCount)} items
        </span>
      </div>
      <p className="m-0 pl-7 text-fg-mid text-small">
        The folder stays on disk. Its tags and notes are lost.
        {goes && (
          <>
            {" "}
            Its <span className="text-fg">{goes.files}</span> {goes.verb} to the Recycle Bin.
          </>
        )}
      </p>
      {here ? (
        <div className="flex flex-col gap-1.5 pl-7">
          <span className="flex items-baseline gap-2 text-fg-mid text-small">
            <span className="min-w-0 flex-1 truncate">Removing {source.title}…</span>
            <span className="text-fg tabular-nums">{here.percent}%</span>
          </span>
          <Bar percent={here.percent} />
        </div>
      ) : (
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
      )}
    </fieldset>
  );
}

/**
 * Removes a source once its files in the Trash have gone to the Recycle Bin, run outside the row
 * so Settings holds still meanwhile; one kept puts its row back. Artboards › Sources.
 */
async function removeNow(source: SourceSummary, onKept: () => void) {
  if (settingsHeld()) return;
  setRefused(null);
  startRemove(source.id);
  const heard = listen<number>("remove-progress", (event) =>
    removeProgress(source.id, event.payload),
  ).catch(() => undefined);
  let ended: RemoveEnd | null = null;
  try {
    const removal = await removeSource(source.id);
    if (removal.kind === "kept") {
      ended = { sentence: notRemoved(source.title, removal.refused), path: removal.trash };
    }
  } catch (error) {
    ended = { sentence: `${source.title} was not removed. ${whyFailed(error)}.` };
  } finally {
    void heard.then((unlisten) => unlisten?.());
  }
  await libraryChanged().catch(() => undefined);
  if (ended) onKept();
  finishRemove(ended);
}

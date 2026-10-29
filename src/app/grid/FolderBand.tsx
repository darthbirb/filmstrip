import { convertFileSrc } from "@tauri-apps/api/core";
import { type CSSProperties, useRef, useState } from "react";

import type { EffectiveTag } from "../../ipc/bindings/EffectiveTag";
import type { FolderDetail } from "../../ipc/bindings/FolderDetail";
import type { FolderStatus } from "../../ipc/bindings/FolderStatus";
import type { KeyBelow } from "../../ipc/bindings/KeyBelow";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import {
  addFolderTag,
  labelKeyOffers,
  labelValueOffers,
  removeFolderTag,
  setFolderFavorite,
  setFolderLabel,
  setFolderNote,
  setFolderStatus,
} from "../../ipc/commands";
import { formatDay, formatShortDate } from "../../lib/format";
import { labelTerm } from "../../lib/queryTerm";
import { Chip } from "../../ui/Chip";
import { ChipButton } from "../../ui/ChipButton";
import { type Fact, Facts } from "../../ui/Facts";
import { Glyph } from "../../ui/Glyph";
import { LabelField, LabelValueField } from "../../ui/LabelField";
import { NoteField } from "../../ui/NoteField";
import { Plate } from "../../ui/Plate";
import { PushDown } from "../../ui/PushDown";
import { Segmented } from "../../ui/Segmented";
import type { Refusal } from "../../ui/TagField";
import { libraryChanged } from "../library";
import { refreshIndex, useIndex } from "../navigation/index-store";
import { type Place, setPlace, usePlace } from "../place";
import { addToSearch, searchFor } from "../search/search";
import { stopsIn, TagsRow, takeOff, titleOf } from "../tags/TagsRow";
import { CoverPicker } from "./CoverPicker";
import { detailChanged, diskPath, useBandOpen, useFolderDetail } from "./folder-detail";

const STATUSES = [
  { value: "none", label: "No Status" },
  { value: "wip", label: "Working" },
  { value: "complete", label: "Complete" },
] as const;

/**
 * What a folder knows about itself, under the grid's header once it is opened: its cover beside
 * its path, status, labels, tags and note, in the pane's details' rhythm. DECISIONS.md "A folder's details".
 */
export function FolderBand() {
  const place = usePlace();
  const open = useBandOpen();
  const { sources } = useIndex();
  const folder = place?.kind === "folder" ? place : null;
  const detail = useFolderDetail(folder?.path.at(-1)?.id ?? null);
  const source = sources?.find((candidate) => candidate.id === folder?.sourceId);
  return (
    <PushDown open={open && detail !== null} className="min-h-0">
      {folder && detail && source && (
        // Positioned, so the radios a segmented group hides are clipped with the rest of it.
        <div className="relative flex h-full gap-4.5 overflow-y-auto pr-3 pb-3 pl-3.5">
          <Cover detail={detail} title={folderTitle(detail, source)} source={source} />
          <div className="min-w-0 flex-1">
            <FolderFacts detail={detail} source={source} />
          </div>
        </div>
      )}
    </PushDown>
  );
}

type FactsProps = { detail: FolderDetail; source: SourceSummary };

/** A folder's name, or its source's for a source's top level. */
export const folderTitle = (detail: FolderDetail, source: SourceSummary) =>
  detail.path.at(-1)?.title ?? source.title;

/** The place a folder is, to go to or to ask its menu for. */
export const folderPlace = (detail: FolderDetail): Place & { kind: "folder" } => ({
  kind: "folder",
  sourceId: detail.sourceId,
  path: detail.path,
});

/**
 * A folder's rows, Path, Status with Favourite, Labels, Tags and the Note, each editing where it
 * stands: one component in the band and in the pane. Pane › folder.
 */
export function FolderFacts({ detail, source }: FactsProps) {
  const place = folderPlace(detail);
  const { favourites } = useIndex();
  const favourite = favourites.some((one) => one.folderId === detail.id);
  const offline = !source.reachable;
  const title = folderTitle(detail, source);
  const labels = detail.tags.filter((tag) => tag.key !== null);
  const tags = detail.tags.filter((tag) => tag.key === null);
  const where = { root: place.path.length === 1, offline };

  const status = (next: FolderStatus | "none") =>
    void setFolderStatus(detail.id, next === "none" ? null : next)
      .then(detailChanged)
      .catch(() => undefined);
  const star = () =>
    void setFolderFavorite(detail.id, !favourite)
      .then(() => refreshIndex())
      .catch(() => undefined);

  const facts: Fact[] = [
    ["Path", <BandPath key="path" place={place} source={source} />],
    [
      "Status",
      <span key="status" className="flex flex-wrap items-center gap-2 py-px">
        <Segmented
          label="Status"
          size="chip"
          options={STATUSES}
          value={detail.status ?? "none"}
          onChange={status}
        />
        <ChipButton
          glyph="star"
          filled={favourite}
          pressed={favourite}
          title={favourite ? "Remove Favourite" : "Favourite"}
          onClick={star}
        >
          Favourite
        </ChipButton>
        {detail.status !== null && detail.statusSetAt !== null && (
          <span className="text-fg-faint text-key tabular-nums">
            set {formatShortDate(detail.statusSetAt)}
          </span>
        )}
      </span>,
    ],
  ];
  facts.push([
    "Labels",
    <LabelsRow
      key="labels"
      folderId={detail.id}
      title={title}
      labels={labels}
      keysBelow={detail.keysBelow}
    />,
  ]);
  facts.push([
    "Tags",
    <TagsRow
      key="tags"
      owner={title}
      tags={tags}
      nameTitle={nameTitle(where)}
      onAdd={(value) => addFolderTag(detail.id, value).then(changed)}
      onRemove={(tagId) => removeFolderTag(detail.id, tagId).then(changed)}
    />,
  ]);
  facts.push([
    "Note",
    <NoteField
      // A note read again starts the row afresh, as another folder's does.
      key={`${detail.id}-${detail.note}`}
      note={detail.note}
      of={title}
      onSave={(note) =>
        void setFolderNote(detail.id, note)
          .then(detailChanged)
          .catch(() => undefined)
      }
    />,
  ]);

  return <Facts facts={facts} />;
}

/** The picture that stands for it; the drive's own when it is away, and a frame when it is empty. */
function Cover({
  detail,
  title,
  source,
}: {
  detail: FolderDetail;
  title: string;
  source: SourceSummary;
}) {
  const frame =
    "grid h-band-cover-height w-band-cover shrink-0 place-items-center rounded-control inset-ring inset-ring-line";
  if (!source.reachable) {
    const why =
      detail.path.length === 1
        ? `${title} is offline · its pictures are on the drive`
        : `${title} is on ${source.title}, which is offline`;
    return (
      <span title={why} className={`${frame} text-fg-faint text-icon`}>
        <Glyph name="unplugged" />
      </span>
    );
  }
  if (detail.allCount === 0) {
    return (
      <span
        title={`Nothing in ${title} to use as a cover`}
        className={`${frame} text-icon text-line-control-hi`}
      >
        <Glyph name="noCover" />
      </span>
    );
  }
  // The picker opens beside the picture, which names itself for it to anchor to.
  const anchor = `--cover-${detail.id}`;
  return (
    <span
      style={{ anchorName: anchor } as CSSProperties}
      className="relative h-band-cover-height w-band-cover shrink-0 overflow-hidden rounded-control bg-inset"
    >
      {/* Its picture exists once its thumbnail is made; until then the ground stands in. */}
      {detail.cover && (
        <img
          src={convertFileSrc(detail.cover)}
          alt=""
          draggable={false}
          className="size-full object-cover"
        />
      )}
      {detail.coverItemId !== null && (
        <Plate look="mark" className="absolute bottom-1.5 left-1.5">
          Cover
        </Plate>
      )}
      <CoverPicker folderId={detail.id} title={title} chosen={detail.coverItemId} anchor={anchor} />
    </span>
  );
}

/** The source's folder, then each folder down, each one a way there; the drive's away, only text. */
function BandPath({ place, source }: { place: Place & { kind: "folder" }; source: SourceSummary }) {
  const { indexedAt, reachable, root } = source;
  const below = place.path.slice(1);
  if (!reachable) {
    const path = diskPath(root, place.path);
    return (
      <span className="flex flex-wrap gap-x-2">
        <span>{path}</span>
        {indexedAt !== null && (
          <span className="font-mono text-fg-dim text-key leading-(--spacing-chip)">
            last indexed {lastIndexed(indexedAt)}
          </span>
        )}
      </span>
    );
  }
  if (below.length === 0) return <span className="text-fg">{root}</span>;
  // The source's own folder goes by its directory here, as a path is written.
  const steps = place.path
    .slice(0, -1)
    .map((crumb, index) => ({ id: crumb.id, title: index === 0 ? root : crumb.title }));
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {steps.map((step, index) => (
        <span key={step.id} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPlace({ ...place, path: place.path.slice(0, index + 1) })}
            className="focus-ring rounded-badge transition-colors duration-(--motion-quick) hover:text-fg motion-reduce:transition-none"
          >
            {step.title}
          </button>
          <Glyph name="chevronRight" className="text-fg-faint text-glyph-small" />
        </span>
      ))}
      <span className="text-fg">{below.at(-1)?.title}</span>
    </span>
  );
}

/** Today and Yesterday read in the line's own case; any other day is a date. */
function lastIndexed(seconds: number) {
  const day = formatDay(seconds);
  return day === "Today" || day === "Yesterday" ? day.toLowerCase() : day;
}

type Where = { root: boolean; offline: boolean };

/** What the folder's own terms changing means: everything below carries something new. */
const changed = () => libraryChanged().then(detailChanged);

type LabelsRowProps = {
  folderId: number;
  title: string;
  labels: EffectiveTag[];
  keysBelow: KeyBelow[];
};

/**
 * The folder's labels and Add Label…. A folder holds one value per key, so a key it has, its own
 * or from above, is refused, and so is one a folder below holds; its own value is changed with a
 * click on it instead.
 */
function LabelsRow({ folderId, title, labels, keysBelow }: LabelsRowProps) {
  const row = useRef<HTMLSpanElement>(null);
  const [echo, setEcho] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const refuseKey = (key: string): Refusal | null => {
    const article = /^[aeiou]/.test(key) ? "an" : "a";
    const had = labels.find((label) => label.key === key);
    if (had) {
      const line = had.from
        ? `${key} comes from ${had.from.title}.`
        : `${title} already has ${article} ${key}. Click its value to change it.`;
      return { line, tagId: had.tagId };
    }
    const below = keysBelow.find((one) => one.key === key);
    if (!below) return null;
    return {
      line: `${below.folder.title}, inside ${title}, already has ${article} ${key}.`,
      tagId: null,
    };
  };

  return (
    <span ref={row} className="flex flex-wrap items-center gap-1.5 py-px">
      {labels.map((label) => {
        const own = label.from === null;
        const key = label.key ?? "";
        if (own && editing === label.tagId) {
          return (
            <LabelValueField
              key={label.tagId}
              tagKey={key}
              value={label.value}
              onCancel={() => setEditing(null)}
              onCommit={(value) => {
                setEditing(null);
                void setFolderLabel(folderId, key, value)
                  .then(changed)
                  .catch(() => undefined);
              }}
            />
          );
        }
        const term = labelTerm(key, label.value);
        return (
          <Chip
            key={`${label.tagId}-${label.from?.id ?? "own"}`}
            value={label.value}
            tagKey={key}
            inherited={!own}
            echoed={label.tagId === echo}
            title={titleOf(label)}
            onSearch={(adding) => void (adding ? addToSearch(term) : searchFor(term))}
            onRemove={
              own
                ? () =>
                    takeOff(
                      () => removeFolderTag(folderId, label.tagId).then(changed),
                      () => stopsIn(row.current),
                    )
                : undefined
            }
            onEdit={own ? () => setEditing(label.tagId) : undefined}
          />
        );
      })}
      <LabelField
        of={title}
        keyOffers={labelKeyOffers}
        valueOffers={labelValueOffers}
        refuseKey={refuseKey}
        onAdd={(key, value) =>
          setFolderLabel(folderId, key, value)
            .then(changed)
            .catch(() => undefined)
        }
        onEcho={setEcho}
      />
    </span>
  );
}

/** What a folder's own name says under the pointer: only a rename changes it. */
function nameTitle(where: Where) {
  if (where.root) {
    return "The source’s name · changes when the source is renamed in Settings or on its row";
  }
  return where.offline
    ? "The folder’s name · changes only when the folder is renamed, which needs the drive"
    : "The folder’s name · changes only when the folder is renamed";
}

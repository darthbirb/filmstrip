import { convertFileSrc } from "@tauri-apps/api/core";
import { type CSSProperties, useRef, useState } from "react";

import type { FolderDetail } from "../../ipc/bindings/FolderDetail";
import type { FolderStatus } from "../../ipc/bindings/FolderStatus";
import type { FolderTag } from "../../ipc/bindings/FolderTag";
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
  tagOffers,
} from "../../ipc/commands";
import { formatDay, formatShortDate } from "../../lib/format";
import { labelTerm, tagTerm } from "../../lib/queryTerm";
import { Chip } from "../../ui/Chip";
import { ChipButton } from "../../ui/ChipButton";
import { type Fact, Facts } from "../../ui/Facts";
import { Glyph } from "../../ui/Glyph";
import { LabelField, LabelValueField } from "../../ui/LabelField";
import { NoteField } from "../../ui/NoteField";
import { Plate } from "../../ui/Plate";
import { PushDown } from "../../ui/PushDown";
import { Segmented } from "../../ui/Segmented";
import { type Refusal, TagField } from "../../ui/TagField";
import { libraryChanged } from "../library";
import { refreshIndex, useIndex } from "../navigation/index-store";
import { type Place, setPlace, usePlace } from "../place";
import { addToSearch, searchFor } from "../search/search";
import { CoverPicker } from "./CoverPicker";
import { detailChanged, useBandOpen, useFolderDetail } from "./folder-detail";

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
      {folder && detail && source && <Body place={folder} detail={detail} source={source} />}
    </PushDown>
  );
}

type BodyProps = {
  place: Place & { kind: "folder" };
  detail: FolderDetail;
  source: SourceSummary;
};

function Body({ place, detail, source }: BodyProps) {
  const { favourites } = useIndex();
  const favourite = favourites.some((one) => one.folderId === detail.id);
  const offline = !source.reachable;
  const title = place.path.at(-1)?.title ?? source.title;
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
    <LabelsRow key="labels" folderId={detail.id} title={title} labels={labels} where={where} />,
  ]);
  facts.push([
    "Tags",
    <TagsRow key="tags" folderId={detail.id} title={title} tags={tags} where={where} />,
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

  return (
    // Positioned, so the radios a segmented group hides are clipped with the rest of it.
    <div className="relative flex h-full gap-4.5 overflow-y-auto pr-3 pb-3 pl-3.5">
      <Cover detail={detail} title={title} source={source} />
      <div className="min-w-0 flex-1">
        <Facts facts={facts} />
      </div>
    </div>
  );
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
        <Plate className="absolute bottom-1.5 left-1.5 text-eyebrow uppercase">Cover</Plate>
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
    const path = [root.replace(/[\\/]+$/, ""), ...below.map((crumb) => crumb.title)].join("\\");
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

type ChipsProps = {
  tags: FolderTag[];
  where: Where;
  /** Takes off one of the folder's own; a name and what it inherits are never offered. */
  onRemove?: (tag: FolderTag) => void;
  /** The tag a value being typed repeats. */
  echo?: number | null;
};

/** Its own first, its name leading, then what it inherits; each searches for itself on a click. */
function Chips({ tags, where, onRemove, echo = null }: ChipsProps) {
  return tags.map((tag) => {
    const term = tag.key ? labelTerm(tag.key, tag.value) : tagTerm(tag.value);
    const own = tag.from === null && !tag.name;
    return (
      <Chip
        key={`${tag.tagId}-${tag.from?.id ?? "own"}`}
        value={tag.value}
        tagKey={tag.key}
        inherited={tag.from !== null}
        name={tag.name}
        echoed={tag.tagId === echo}
        title={titleOf(tag, where)}
        onSearch={(adding) => void (adding ? addToSearch(term) : searchFor(term))}
        onRemove={own && onRemove ? () => onRemove(tag) : undefined}
      />
    );
  });
}

/** What the folder's own terms changing means: everything below carries something new. */
const changed = () => libraryChanged().then(detailChanged);

/** Takes a tag or a label off; one taken off with the keyboard hands the focus to the next. */
function takeOff(folderId: number, tag: FolderTag, stops: () => HTMLElement[]) {
  const at = stops().indexOf(document.activeElement as HTMLElement);
  void removeFolderTag(folderId, tag.tagId)
    .then(changed)
    // What was after it now stands where it stood.
    .then(() => at >= 0 && requestAnimationFrame(() => stops()[at]?.focus()))
    .catch(() => undefined);
}

type LabelsRowProps = { folderId: number; title: string; labels: FolderTag[]; where: Where };

/**
 * The folder's labels and Add Label…. A folder holds one value per key, so a key it has, its own
 * or from above, is refused; its own value is changed with a click on it instead.
 */
function LabelsRow({ folderId, title, labels, where }: LabelsRowProps) {
  const row = useRef<HTMLSpanElement>(null);
  const [echo, setEcho] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const stops = () => [
    ...(row.current?.querySelectorAll<HTMLElement>("button:not([tabindex='-1'])") ?? []),
  ];

  const refuseKey = (key: string): Refusal | null => {
    const had = labels.find((label) => label.key === key);
    if (!had) return null;
    const article = /^[aeiou]/.test(key) ? "an" : "a";
    const line = had.from
      ? `${key} comes from ${had.from.title}.`
      : `${title} already has ${article} ${key}. Click its value to change it.`;
    return { line, tagId: had.tagId };
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
            title={titleOf(label, where)}
            onSearch={(adding) => void (adding ? addToSearch(term) : searchFor(term))}
            onRemove={own ? () => takeOff(folderId, label, stops) : undefined}
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

type TagsRowProps = { folderId: number; title: string; tags: FolderTag[]; where: Where };

/**
 * The folder's tags and Add Tag…. A tag it carries already, its own or from above, is refused
 * where it is typed; one taken off with the keyboard hands the focus to the next.
 */
function TagsRow({ folderId, title, tags, where }: TagsRowProps) {
  const row = useRef<HTMLSpanElement>(null);
  const [echo, setEcho] = useState<number | null>(null);
  const stops = () => [
    ...(row.current?.querySelectorAll<HTMLElement>("button:not([tabindex='-1'])") ?? []),
  ];

  const refuse = (value: string): Refusal | null => {
    const had = tags.find((tag) => tag.value === value);
    if (!had) return null;
    const line = had.from
      ? `${title} already has ${value}, ${had.name ? "the name of" : "from"} ${had.from.title}.`
      : had.name
        ? `${value} is this folder’s name.`
        : `${title} already has ${value}.`;
    return { line, tagId: had.tagId };
  };
  const remove = (tag: FolderTag) => takeOff(folderId, tag, stops);
  const backOut = () => {
    const own = row.current?.querySelectorAll<HTMLElement>("button[data-removable]");
    own?.[own.length - 1]?.focus();
  };

  return (
    <span ref={row} className="flex flex-wrap items-center gap-1.5 py-px">
      <Chips tags={tags} where={where} onRemove={remove} echo={echo} />
      <TagField
        of={title}
        offers={tagOffers}
        refuse={refuse}
        onAdd={(value) =>
          addFolderTag(folderId, value)
            .then(changed)
            .catch(() => undefined)
        }
        onEcho={setEcho}
        onBackOut={backOut}
      />
    </span>
  );
}

function titleOf(tag: FolderTag, where: Where) {
  if (tag.from) return tag.name ? `The name of ${tag.from.title}` : `From ${tag.from.title}`;
  if (!tag.name) return tag.key ? `Search ${tag.key}: ${tag.value}` : `Search ${tag.value}`;
  if (where.root) {
    return "The source’s name · changes when the source is renamed in Settings or on its row";
  }
  return where.offline
    ? "The folder’s name · changes only when the folder is renamed, which needs the drive"
    : "The folder’s name · changes only when the folder is renamed";
}

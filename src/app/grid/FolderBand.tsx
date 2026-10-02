import { convertFileSrc } from "@tauri-apps/api/core";

import type { FolderDetail } from "../../ipc/bindings/FolderDetail";
import type { FolderStatus } from "../../ipc/bindings/FolderStatus";
import type { FolderTag } from "../../ipc/bindings/FolderTag";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { setFolderFavorite, setFolderStatus } from "../../ipc/commands";
import { formatDay, formatShortDate } from "../../lib/format";
import { labelTerm, tagTerm } from "../../lib/queryTerm";
import { Chip } from "../../ui/Chip";
import { ChipButton } from "../../ui/ChipButton";
import { type Fact, Facts } from "../../ui/Facts";
import { Glyph } from "../../ui/Glyph";
import { Plate } from "../../ui/Plate";
import { PushDown } from "../../ui/PushDown";
import { Segmented } from "../../ui/Segmented";
import { refreshIndex, useIndex } from "../navigation/index-store";
import { type Place, setPlace, usePlace } from "../place";
import { addToSearch, searchFor } from "../search/search";
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
  if (labels.length > 0) {
    facts.push(["Labels", <Chips key="labels" tags={labels} where={where} />]);
  }
  facts.push(["Tags", <Chips key="tags" tags={tags} where={where} />]);
  if (detail.note) {
    facts.push([
      "Note",
      <span key="note" className="text-pretty">
        {detail.note}
      </span>,
    ]);
  }

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
  // Its picture exists once its thumbnail is made; until then the frame stands in.
  if (!detail.cover) return <span className={`${frame} bg-inset`} />;
  return (
    <span className="relative h-band-cover-height w-band-cover shrink-0 overflow-hidden rounded-control">
      <img
        src={convertFileSrc(detail.cover)}
        alt=""
        draggable={false}
        className="size-full object-cover"
      />
      {detail.coverItemId !== null && (
        <Plate className="absolute bottom-1.5 left-1.5 text-eyebrow uppercase">Cover</Plate>
      )}
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

/** Its own first, its name leading, then what it inherits; each searches for itself on a click. */
function Chips({ tags, where }: { tags: FolderTag[]; where: Where }) {
  return (
    <span className="flex flex-wrap gap-1.5 py-px">
      {tags.map((tag) => {
        const term = tag.key ? labelTerm(tag.key, tag.value) : tagTerm(tag.value);
        return (
          <Chip
            key={`${tag.tagId}-${tag.from?.id ?? "own"}`}
            value={tag.value}
            tagKey={tag.key}
            inherited={tag.from !== null}
            name={tag.name}
            title={titleOf(tag, where)}
            onSearch={(adding) => void (adding ? addToSearch(term) : searchFor(term))}
          />
        );
      })}
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

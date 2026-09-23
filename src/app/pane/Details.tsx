import { Fragment, type ReactNode } from "react";

import type { EffectiveTag } from "../../ipc/bindings/EffectiveTag";
import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { formatBytes, formatDate, formatDimensions, formatDuration } from "../../lib/format";
import { Chip, Stat } from "../../ui/Chip";
import { type Fact, Facts } from "../../ui/Facts";
import { Glyph } from "../../ui/Glyph";
import { setPlace } from "../place";

/** Where the item is, its file, its dates, its labels and tags, and the name it has on disk. */
export function Details({ item, tags }: { item: ItemDetail; tags: EffectiveTag[] }) {
  const facts: Fact[] = [
    ["Where", <Where key="where" item={item} />],
    ["File", <File key="file" item={item} />],
    ["Dates", <Dates key="dates" item={item} />],
  ];
  const labels = tags.filter((tag) => tag.key);
  const plain = tags.filter((tag) => !tag.key);
  if (labels.length > 0) facts.push(["Labels", <Tags key="labels" tags={labels} />]);
  if (plain.length > 0) facts.push(["Tags", <Tags key="tags" tags={plain} />]);
  facts.push([
    "Name",
    <span key="name" className="break-all">
      {item.diskName}
    </span>,
  ]);
  return <Facts facts={facts} />;
}

/** Each folder down to the item goes there; the Sorting Box is one place, so only it does. */
function Where({ item }: { item: ItemDetail }) {
  const sorting = item.sourceKind === "sorting";
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      {sorting && <Step onClick={() => setPlace({ kind: "sorting" })}>Sorting Box</Step>}
      {item.folders.map((folder, index) => (
        <Fragment key={folder.id}>
          {(sorting || index > 0) && (
            <Glyph name="chevronRight" className="text-fg-faint text-glyph-small" />
          )}
          {sorting ? (
            <span>{folder.title}</span>
          ) : (
            <Step
              onClick={() =>
                setPlace({
                  kind: "folder",
                  sourceId: item.sourceId,
                  path: item.folders.slice(0, index + 1),
                })
              }
            >
              {folder.title}
            </Step>
          )}
        </Fragment>
      ))}
    </span>
  );
}

function Step({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring rounded-badge text-left text-fg-mid transition-colors duration-(--motion-quick) hover:text-fg motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

/** The measured facts as chips, and the kind of file after them, quieter. */
function File({ item }: { item: ItemDetail }) {
  const kind = [item.ext.toUpperCase(), item.codec?.toUpperCase()].filter(Boolean).join(" · ");
  return (
    <span className="flex flex-wrap gap-1.5 py-px">
      {item.width !== null && item.height !== null && (
        <Stat>{formatDimensions(item.width, item.height)}</Stat>
      )}
      {item.durationMs !== null && <Stat>{formatDuration(item.durationMs)}</Stat>}
      <Stat>{formatBytes(item.sizeBytes)}</Stat>
      {kind && <Stat quiet>{kind}</Stat>}
    </span>
  );
}

/** When it was taken, if known, then changed and added; the first known stands out. */
function Dates({ item }: { item: ItemDetail }) {
  const dates: [string, string][] = [];
  if (item.capturedAt !== null) {
    dates.push(["Taken", formatDate(item.capturedAt, item.capturedSrc === "exif")]);
  }
  dates.push(["Modified", formatDate(item.mtime)], ["Added", formatDate(item.addedAt)]);
  return (
    <span className="flex flex-col">
      {dates.map(([what, when], index) => (
        <span key={what} className="text-fg-dim">
          {what} <span className={index === 0 ? "text-fg" : ""}>{when}</span>
        </span>
      ))}
    </span>
  );
}

/** A label is never shown without its key. PRODUCT.md "Tags and labels". */
function Tags({ tags }: { tags: EffectiveTag[] }) {
  return (
    <span className="flex flex-wrap gap-1.5 py-px">
      {tags.map((tag) => (
        <Chip
          key={`${tag.tagId}-${tag.originId ?? "own"}`}
          value={tag.value}
          tagKey={tag.key}
          inherited={tag.originId !== null}
          title={tag.originTitle ? `From ${tag.originTitle}` : "On This File"}
        />
      ))}
    </span>
  );
}

import { Fragment, type ReactNode } from "react";

import type { EffectiveTag } from "../../ipc/bindings/EffectiveTag";
import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { formatBytes, formatDate, formatDimensions, formatDuration } from "../../lib/format";
import { Chip } from "../../ui/Chip";
import { type Fact, Facts } from "../../ui/Facts";
import { GLYPHS } from "../../ui/glyphs";
import { setPlace } from "../place";

/** The item's name, heading whatever the pane shows of it. */
export function Title({ item, className = "" }: { item: ItemDetail; className?: string }) {
  return (
    <h2
      title={item.diskName}
      className={`m-0 min-w-0 break-all font-title text-title ${className}`}
    >
      {item.diskName}
    </h2>
  );
}

/** Where the item is, when it was taken, its shape and its file, and its tags. */
export function Details({ item, tags }: { item: ItemDetail; tags: EffectiveTag[] }) {
  const facts: Fact[] = [["Where", <Where key="where" item={item} />]];
  if (item.capturedAt !== null) {
    facts.push(["Taken", formatDate(item.capturedAt, item.capturedSrc === "exif")]);
  }
  facts.push(["Modified", formatDate(item.mtime)]);
  if (item.width !== null && item.height !== null) {
    facts.push(["Dimensions", formatDimensions(item.width, item.height)]);
  }
  if (item.durationMs !== null) facts.push(["Length", formatDuration(item.durationMs)]);
  const file = [item.ext.toUpperCase(), item.codec?.toUpperCase(), formatBytes(item.sizeBytes)];
  facts.push(["File", file.filter(Boolean).join(" · ")]);
  if (tags.length > 0) facts.push(["Tags", <Tags key="tags" tags={tags} />]);
  return <Facts facts={facts} />;
}

/** Each folder down to the item goes there; the Sorting Box is one place, so only it does. */
function Where({ item }: { item: ItemDetail }) {
  const sorting = item.sourceKind === "sorting";
  return (
    <span className="flex flex-wrap items-center gap-x-1 font-sans">
      {sorting && <Step onClick={() => setPlace({ kind: "sorting" })}>Sorting Box</Step>}
      {item.folders.map((folder, index) => (
        <Fragment key={folder.id}>
          {(sorting || index > 0) && (
            <span aria-hidden="true" className="font-glyph text-fg-muted text-glyph">
              {GLYPHS.chevronRight}
            </span>
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
      className="focus-ring rounded-control text-left underline-offset-2 hover:underline"
    >
      {children}
    </button>
  );
}

/** A label is never shown without its key. PRODUCT.md "Tags and labels". */
function Tags({ tags }: { tags: EffectiveTag[] }) {
  return (
    <span className="flex flex-wrap gap-1 font-sans">
      {tags.map((tag) => (
        <Chip
          key={`${tag.tagId}-${tag.originId ?? "own"}`}
          value={tag.value}
          tagKey={tag.key}
          inherited={tag.originId !== null}
          title={tag.originTitle ? `From ${tag.originTitle}` : "On this file"}
        />
      ))}
    </span>
  );
}

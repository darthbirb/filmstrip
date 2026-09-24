import { Fragment, type ReactNode, useState } from "react";

import type { EffectiveTag } from "../../ipc/bindings/EffectiveTag";
import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import {
  formatBytes,
  formatDate,
  formatDimensions,
  formatDuration,
  formatWhen,
} from "../../lib/format";
import { Chip, Stat } from "../../ui/Chip";
import { type Fact, Facts } from "../../ui/Facts";
import { Glyph } from "../../ui/Glyph";
import { NameField } from "../../ui/NameField";
import { setPlace } from "../place";
import { renameFile, startRename, stopRename, useRenaming } from "./rename";

/** Where the item is, its file, its dates, its labels and tags, and the name it has on disk. */
export function Details({ item, tags }: { item: ItemDetail; tags: EffectiveTag[] }) {
  // In the Trash it is where it came from and when it went; its own name, never the Trash's.
  if (item.trashedAt !== null) {
    return (
      <Facts
        facts={[
          ["From", <From key="from" item={item} />],
          ["Deleted", formatWhen(item.trashedAt)],
          ["File", <File key="file" item={item} />],
          [
            "Name",
            <span key="name" className="break-all">
              {item.diskName}
            </span>,
          ],
        ]}
      />
    );
  }
  const facts: Fact[] = [
    ["Where", <Where key="where" item={item} />],
    ["File", <File key="file" item={item} />],
    ["Dates", <Dates key="dates" item={item} />],
  ];
  const labels = tags.filter((tag) => tag.key);
  const plain = tags.filter((tag) => !tag.key);
  if (labels.length > 0) facts.push(["Labels", <Tags key="labels" tags={labels} />]);
  if (plain.length > 0) facts.push(["Tags", <Tags key="tags" tags={plain} />]);
  facts.push(["Name", <Name key="name" item={item} />]);
  return <Facts facts={facts} />;
}

/** The name on disk; pressed, or asked for from a menu, it becomes the field that renames it. */
function Name({ item }: { item: ItemDetail }) {
  const renaming = useRenaming() === item.id;
  const [taken, setTaken] = useState<string | null>(null);
  if (!renaming) {
    return (
      <button
        type="button"
        title="Rename"
        onClick={() => startRename(item.id)}
        className="group focus-ring flex items-center gap-1.5 rounded-badge text-left"
      >
        <span className="break-all">{item.diskName}</span>
        <Glyph
          name="rename"
          className="shrink-0 text-fg-dim text-glyph opacity-0 transition-opacity duration-(--motion-quick) group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        />
      </button>
    );
  }
  return (
    <NameField
      label={`Rename ${item.diskName}`}
      name={item.diskName}
      taken={taken}
      onEdit={() => setTaken(null)}
      onCommit={(name) => void renameFile(item.id, name).then(setTaken)}
      onCancel={() => {
        setTaken(null);
        stopRename();
      }}
    />
  );
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

/** The folder a trashed file left, named down from its source; it may have gone, so it goes nowhere. */
function From({ item }: { item: ItemDetail }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-fg-mid">
      {item.folders.map((folder, index) => (
        <Fragment key={folder.id}>
          {index > 0 && <Glyph name="chevronRight" className="text-fg-faint text-glyph-small" />}
          <span>{folder.title}</span>
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

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { formatBytes, formatCount, formatDimensions, formatDuration } from "../../lib/format";
import { EmptyState } from "../../ui/EmptyState";
import { GlyphButton } from "../../ui/GlyphButton";
import { PushDown } from "../../ui/PushDown";
import { usePreferences } from "../preferences";
import { Actions } from "./Actions";
import { Details } from "./Details";
import { DETAILS_ID, DetailsToggle } from "./DetailsToggle";
import { FolderPane, FolderPaneHeader } from "./FolderPane";
import { setFullScreen, useFullScreen } from "./full-screen";
import { Media } from "./Media";
import { PaneSet } from "./PaneSet";
import { usePaneDetail, usePaneFolderDetail, usePaneSetDetail } from "./pane-detail";
import { usePaneSet } from "./pane-store";
import { Strip } from "./Strip";

/**
 * The pane's header row: the way into full screen, then the item's shape and size, opening onto
 * everything else known about it. Both go with the item, so an empty pane's header holds only its fold.
 */
export function PaneHeader() {
  const shown = usePaneDetail();
  const set = usePaneSet();
  const several = usePaneSetDetail();
  const folder = usePaneFolderDetail();
  const full = useFullScreen();
  const into = (
    <GlyphButton
      glyph={full ? "leaveFullScreen" : "fullScreen"}
      label={full ? "Exit Full Screen" : "Full Screen"}
      pressed={full}
      onClick={() => setFullScreen(!full)}
    />
  );
  if (folder.status !== "empty") return <FolderPaneHeader shown={folder} into={into} />;
  // Details are about one file, so a set's header counts them and is not a disclosure.
  if (set.length > 1) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        {into}
        <span className="flex h-control min-w-0 flex-1 items-center px-2 text-fg-mid text-ui tabular-nums">
          <span className="min-w-0 truncate">{setSummary(set.length, several)}</span>
        </span>
      </div>
    );
  }
  if (shown.status !== "ready") return null;
  return (
    <DetailsToggle into={into}>
      <span className="min-w-0 flex-1 truncate">{summary(shown.item)}</span>
    </DetailsToggle>
  );
}

/** The item last clicked: its details when opened, the picture, and the strip it was chosen from. PRODUCT.md "The three panels". */
export function Pane() {
  const shown = usePaneDetail();
  const set = usePaneSet();
  const several = usePaneSetDetail();
  const folder = usePaneFolderDetail();
  const open = usePreferences().details ?? false;
  if (folder.status !== "empty") return <FolderPane shown={folder} />;
  if (set.length > 1) {
    // The bar goes, as wherever there is no one file to act on. Pane › several.
    return (
      <div className="flex h-full flex-col">
        <h2 className="sr-only">{setSummary(set.length, null)}</h2>
        <div className="flex min-h-0 flex-1 p-2">{several && <PaneSet items={several} />}</div>
        <Strip />
      </div>
    );
  }
  if (shown.status === "loading") return null;
  if (shown.status !== "ready") return <Empty gone={shown.status === "gone" ? shown : null} />;
  const { item, tags } = shown;
  return (
    <div className="flex h-full flex-col">
      <h2 className="sr-only">{item.diskName}</h2>
      <PushDown open={open} className="max-h-1/2 shrink-0">
        <section
          id={DETAILS_ID}
          aria-label="Details"
          className="h-full overflow-auto border-line border-b px-3 pt-1.5 pb-3"
        >
          <Details item={item} tags={tags} />
        </section>
      </PushDown>
      {/* The gap around the picture is the pane itself, so it is the pane's own inset. */}
      <div className="flex min-h-0 flex-1 p-2">
        <Media key={item.id} item={item} fill />
      </div>
      <Actions key={item.id} item={item} />
      <Strip />
    </div>
  );
}

function Empty({ gone }: { gone: { path: string | null } | null }) {
  return gone ? (
    <EmptyState glyph="image" title="This File Has Gone" path={gone.path ?? undefined} />
  ) : (
    <EmptyState glyph="image" title="Nothing Chosen Yet" />
  );
}

/** How many files a set holds, and once they are read, what they weigh together. */
function setSummary(count: number, items: readonly ItemDetail[] | null) {
  const files = `${formatCount(count)} Files`;
  if (!items) return files;
  return `${files} · ${formatBytes(items.reduce((sum, item) => sum + item.sizeBytes, 0))}`;
}

/** Shape, length and size: what the header row says before the details are opened. */
function summary(item: ItemDetail) {
  return [
    item.width !== null && item.height !== null ? formatDimensions(item.width, item.height) : null,
    item.durationMs !== null ? formatDuration(item.durationMs) : null,
    formatBytes(item.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");
}

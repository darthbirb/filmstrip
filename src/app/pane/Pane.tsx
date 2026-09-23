import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { formatBytes, formatDimensions, formatDuration } from "../../lib/format";
import { EmptyState } from "../../ui/EmptyState";
import { Glyph } from "../../ui/Glyph";
import { GlyphButton } from "../../ui/GlyphButton";
import { PushDown } from "../../ui/PushDown";
import { updatePreferences, usePreferences } from "../preferences";
import { Actions } from "./Actions";
import { Details } from "./Details";
import { setFullScreen, useFullScreen } from "./full-screen";
import { Media } from "./Media";
import { usePaneDetail } from "./pane-detail";
import { Strip } from "./Strip";

const DETAILS_ID = "pane-details";

/**
 * The pane's header row: the way into full screen, then the item's shape and size, opening onto
 * everything else known about it. Both go with the item, so an empty pane's header holds only its fold.
 */
export function PaneHeader() {
  const shown = usePaneDetail();
  const open = usePreferences().details ?? false;
  const full = useFullScreen();
  if (shown.status !== "ready") return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <GlyphButton
        glyph={full ? "leaveFullScreen" : "fullScreen"}
        label={full ? "Exit Full Screen" : "Full Screen"}
        pressed={full}
        onClick={() => setFullScreen(!full)}
      />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={DETAILS_ID}
        onClick={() => updatePreferences({ details: !open })}
        className="focus-ring flex h-control w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-fg-mid text-ui tabular-nums transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg aria-expanded:bg-raised aria-expanded:text-fg motion-reduce:transition-none"
      >
        <Glyph
          name="chevronRight"
          className={`text-fg-dim text-icon transition-transform duration-(--motion-quick) ease-out motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
        <span className="min-w-0 flex-1 truncate">{summary(shown.item)}</span>
      </button>
    </div>
  );
}

/** The item last clicked: its details when opened, the picture, and the strip it was chosen from. PRODUCT.md "The three panels". */
export function Pane() {
  const shown = usePaneDetail();
  const open = usePreferences().details ?? false;
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

import { type ReactElement, useState } from "react";

import type { EffectiveTag } from "../../ipc/bindings/EffectiveTag";
import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { Details, Title } from "./Details";
import { Media } from "./Media";
import { usePaneItem } from "./pane-store";
import { useItemDetail } from "./useItemDetail";

/** Three structures for the pane, compared live until one is picked. DEVELOPMENT.md "Slices". */
export const PANE_CANDIDATES = ["stack", "viewer", "split"] as const;
export type PaneCandidate = (typeof PANE_CANDIDATES)[number];

type ViewProps = { item: ItemDetail; tags: EffectiveTag[] };

/** The item last clicked in the grid. PRODUCT.md "The three panels". */
export function Pane({ candidate }: { candidate: PaneCandidate }) {
  const shown = useItemDetail(usePaneItem());
  if (shown.status === "loading") return null;
  if (shown.status !== "ready") {
    return (
      <p className="m-0 px-3 py-2 text-fg-muted text-ui">
        {shown.status === "gone"
          ? "This file is no longer here."
          : "Click a picture to see it here."}
      </p>
    );
  }
  const View = VIEWS[candidate];
  return <View item={shown.item} tags={shown.tags} />;
}

/** The picture at its own shape, then everything about it, scrolling as one. */
function Stack({ item, tags }: ViewProps) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <Media key={item.id} item={item} />
      <Title item={item} />
      <Details item={item} tags={tags} />
    </div>
  );
}

/** The picture fills the pane; its details open beneath it on request. */
function Viewer({ item, tags }: ViewProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Media key={item.id} item={item} fill />
      </div>
      {open && (
        <div className="max-h-1/2 shrink-0 overflow-auto border-line border-t p-3">
          <Details item={item} tags={tags} />
        </div>
      )}
      <div className="flex h-toolbar shrink-0 items-center gap-2 border-line border-t pl-3">
        <Title item={item} className="flex-1 truncate" />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="focus-ring flex h-full shrink-0 items-center px-3 text-caption text-fg-muted transition-colors duration-(--motion-quick) hover:bg-hover hover:text-fg motion-reduce:transition-none"
        >
          Details
        </button>
      </div>
    </div>
  );
}

/** The picture above and the details below, each keeping its share of the height. */
function Split({ item, tags }: ViewProps) {
  return (
    <div className="grid h-full grid-rows-[3fr_2fr]">
      <div className="flex min-h-0 border-line border-b">
        <Media key={item.id} item={item} fill />
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-auto p-3">
        <Title item={item} />
        <Details item={item} tags={tags} />
      </div>
    </div>
  );
}

const VIEWS: Record<PaneCandidate, (props: ViewProps) => ReactElement> = {
  stack: Stack,
  viewer: Viewer,
  split: Split,
};

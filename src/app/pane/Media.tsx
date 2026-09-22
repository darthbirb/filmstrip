import { convertFileSrc } from "@tauri-apps/api/core";
import { type ReactNode, useState } from "react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";

type Props = {
  item: ItemDetail;
  /** Fill the space given, or take the item's own shape across the width. */
  fill?: boolean;
};

// The picture sizes itself and carries the corner, so nothing is drawn around it. DECISIONS.md "The pane".
const PICTURE = "max-h-full max-w-full rounded-control";

/** The item itself: a picture over its thumbnail until the original arrives, or a video over its poster. */
export function Media({ item, fill = false }: Props) {
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const thumb = item.thumb ? convertFileSrc(item.thumb) : undefined;

  let body: ReactNode;
  if (item.kind === "video") {
    body = (
      // biome-ignore lint/a11y/useMediaCaption: the user's own recordings come with no captions to offer
      <video
        className={PICTURE}
        style={{ aspectRatio: aspect(item) }}
        src={convertFileSrc(item.path)}
        poster={thumb}
        controls
        preload="metadata"
        onError={() => setState("failed")}
      />
    );
  } else if (item.kind === "image") {
    body = (
      <>
        {thumb && state !== "shown" && (
          // Centred under the original by its own auto margins, so both sit in the same place.
          <img className={`absolute inset-0 m-auto ${PICTURE}`} src={thumb} alt="" />
        )}
        <img
          className={`${PICTURE} ${state === "shown" ? "" : "opacity-0"}`}
          src={convertFileSrc(item.path)}
          alt={item.diskName}
          decoding="async"
          onLoad={() => setState("shown")}
          onError={() => setState("failed")}
        />
      </>
    );
  } else {
    body = <span className="text-fg-dim text-ui">{item.ext.toUpperCase() || "File"}</span>;
  }

  return (
    <figure className={`m-0 flex flex-col ${fill ? "min-h-0 min-w-0 flex-1" : "w-full"}`}>
      {/* A box that can be smaller than what it holds, so a tall picture shrinks to it rather than
          running past the actions below. DESIGN.md "Shapes". */}
      <div
        className={`relative flex min-h-0 items-center justify-center ${fill ? "flex-1" : "max-h-(--pane-media-max) w-full"}`}
      >
        {body}
      </div>
      {state === "failed" && (
        <figcaption className="px-1 pt-2 font-mono text-fg-dim text-small">.{item.ext}</figcaption>
      )}
    </figure>
  );
}

function aspect(item: ItemDetail) {
  return item.width && item.height ? item.width / item.height : 4 / 3;
}

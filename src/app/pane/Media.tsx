import { convertFileSrc } from "@tauri-apps/api/core";
import { type ReactNode, useState } from "react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";

type Props = {
  item: ItemDetail;
  /** Fill the space given, or take the item's own shape across the width. */
  fill?: boolean;
};

/** The item itself: a picture over its thumbnail until the original arrives, or a video over its poster. */
export function Media({ item, fill = false }: Props) {
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const thumb = item.thumb ? convertFileSrc(item.thumb) : undefined;
  const layer = "absolute inset-0 size-full object-contain";

  let body: ReactNode;
  if (item.kind === "video") {
    body = (
      // biome-ignore lint/a11y/useMediaCaption: the user's own recordings come with no captions to offer
      <video
        className={layer}
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
        {thumb && state !== "shown" && <img className={layer} src={thumb} alt="" />}
        <img
          className={`${layer} ${state === "shown" ? "" : "opacity-0"}`}
          src={convertFileSrc(item.path)}
          alt={item.diskName}
          decoding="async"
          onLoad={() => setState("shown")}
          onError={() => setState("failed")}
        />
      </>
    );
  } else {
    body = (
      <span className="absolute inset-0 flex items-center justify-center text-fg-dim text-ui">
        {item.ext.toUpperCase() || "File"}
      </span>
    );
  }

  return (
    <figure className={`m-0 flex flex-col ${fill ? "min-h-0 min-w-0 flex-1" : "w-full"}`}>
      <div
        className={`relative overflow-hidden rounded-control bg-well ${fill ? "min-h-0 flex-1" : "max-h-(--pane-media-max) w-full"}`}
        style={fill ? undefined : { aspectRatio: aspect(item) }}
      >
        {body}
      </div>
      {state === "failed" && (
        <figcaption className="px-1 pt-1 text-fg-dim text-small">
          {thumb
            ? `The window can't open .${item.ext} files, so this is its thumbnail.`
            : `The window can't open .${item.ext} files.`}
        </figcaption>
      )}
    </figure>
  );
}

function aspect(item: ItemDetail) {
  return item.width && item.height ? item.width / item.height : 4 / 3;
}

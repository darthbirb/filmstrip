import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { copyItemFile, openItem, revealItem } from "../../ipc/commands";
import { Button } from "../../ui/Button";
import { GlyphButton } from "../../ui/GlyphButton";
import type { GlyphName } from "../../ui/glyphs";
import { Menu } from "../../ui/Menu";
import { setFavourite, useFavourite } from "../favourites";
import { openMovePicker } from "./move-picker";

type Action = { id: string; label: string; glyph: GlyphName; run: () => void };

/** What the app can do to the file the pane is showing. DECISIONS.md "The pane". */
export function Actions({ item }: { item: ItemDetail }) {
  const bar = useRef<HTMLDivElement>(null);
  const kept = useRef<HTMLDivElement>(null);
  const moveTo = useRef<HTMLButtonElement>(null);
  const favorite = useFavourite(item.id, item.favorite);

  // Written in the order the drawing writes them, which is also the order they leave the bar.
  const actions: Action[] = [
    {
      id: "reveal",
      label: "Show in Explorer",
      glyph: "folderOpen",
      run: () => void revealItem(item.id).catch(() => undefined),
    },
    {
      id: "copy",
      label: "Copy",
      glyph: "copy",
      run: () => void copyItemFile(item.id).catch(() => undefined),
    },
    {
      id: "open",
      label: "Open with Default App",
      glyph: "openExternal",
      run: () => void openItem(item.id).catch(() => undefined),
    },
  ];

  const fits = useFitting(bar, kept, actions.length);
  const shown = actions.slice(0, fits);
  const folded = actions.slice(fits);

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Actions"
      className="flex h-toolbar shrink-0 items-center gap-1.5 border-line border-t px-1.5"
    >
      {/* Favourite and Move to… never leave the bar: they are the two that change the library. */}
      <div ref={kept} className="flex shrink-0 items-center gap-1.5">
        <GlyphButton
          glyph="star"
          filled={favorite}
          pressed={favorite}
          label={favorite ? "Remove Favourite" : "Favourite"}
          onClick={() => setFavourite(item.id, !favorite)}
        />
        <Button
          ref={moveTo}
          glyph="moveTo"
          onClick={() => {
            const element = moveTo.current;
            if (element) {
              openMovePicker({ itemIds: [item.id], folderId: item.folderId, anchor: { element } });
            }
          }}
        >
          Move to…
        </Button>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {shown.map((action) => (
          <GlyphButton
            key={action.id}
            glyph={action.glyph}
            label={action.label}
            onClick={action.run}
          />
        ))}
        {folded.length > 0 && (
          <Menu
            label="More"
            glyph="more"
            groups={[
              folded.map((action) => ({
                id: action.id,
                label: action.label,
                glyph: action.glyph,
                onSelect: action.run,
              })),
            ]}
          />
        )}
      </div>
    </div>
  );
}

/**
 * How many of the glyph buttons the bar has room for beside what it always keeps, the ⋯ taking
 * a square once any have left. Measured, never a width written down.
 */
function useFitting(
  bar: RefObject<HTMLElement | null>,
  kept: RefObject<HTMLElement | null>,
  count: number,
) {
  const [fits, setFits] = useState(count);

  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      // Every glyph button is the same square, so one of them measures them all.
      const unit = element.querySelector("button")?.getBoundingClientRect().width ?? 0;
      const room = element.clientWidth - padding - (kept.current?.offsetWidth ?? 0) - gap;
      if (unit <= 0 || room <= 0) return;
      const width = (n: number) => n * (unit + gap) - gap + (n < count ? unit + gap : 0);
      let n = count;
      while (n > 0 && width(n) > room) n--;
      setFits(n);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bar, kept, count]);

  return fits;
}

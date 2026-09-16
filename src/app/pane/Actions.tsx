import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { copyItemFile, openItem, revealItem, setItemFavorite } from "../../ipc/commands";
import { GlyphButton } from "../../ui/GlyphButton";
import type { GlyphName } from "../../ui/glyphs";
import { Menu } from "../../ui/Menu";

type Action = { id: string; label: string; glyph: GlyphName; run: () => void };

/** What the app can do to the file the pane is showing. DECISIONS.md "The pane". */
export function Actions({ item }: { item: ItemDetail }) {
  const bar = useRef<HTMLDivElement>(null);
  const [favorite, setFavorite] = useState(item.favorite);

  // Written in the order the drawing writes them, which is also the order they leave the bar.
  const actions: Action[] = [
    {
      id: "reveal",
      label: "Reveal in Explorer",
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
      label: "Open with the default app",
      glyph: "openExternal",
      run: () => void openItem(item.id).catch(() => undefined),
    },
  ];

  const fits = useFitting(bar, actions.length);
  const shown = actions.slice(0, fits);
  const folded = actions.slice(fits);

  const toggleFavorite = () => {
    const next = !favorite;
    setFavorite(next);
    void setItemFavorite([item.id], next).catch(() => setFavorite(!next));
  };

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Actions"
      className="flex h-toolbar shrink-0 items-center gap-1.5 border-line border-t px-1.5"
    >
      {/* Favourite never leaves the bar: it is the one that changes the library. */}
      <GlyphButton
        glyph="star"
        filled={favorite}
        pressed={favorite}
        label={favorite ? "Favourited" : "Favourite"}
        onClick={toggleFavorite}
      />
      <div className="ml-auto flex items-center gap-1.5">
        {shown.map((action) => (
          <GlyphButton
            key={action.id}
            glyph={action.glyph}
            label={action.label}
            onClick={action.run}
          />
        ))}
        {/* The drawing keeps the menu always, for a Rename that has nothing behind it yet. */}
        {folded.length > 0 && (
          <Menu
            label="Everything else"
            glyph="more"
            actions={folded.map((action) => ({
              id: action.id,
              label: action.label,
              glyph: action.glyph,
              onSelect: action.run,
            }))}
          />
        )}
      </div>
    </div>
  );
}

/** How many glyph buttons the bar has room for. Measured, never a width written down. */
function useFitting(bar: RefObject<HTMLElement | null>, count: number) {
  const [fits, setFits] = useState(count);

  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      // Every button in the bar is the same square, so one of them measures them all.
      const unit = element.querySelector("button")?.getBoundingClientRect().width ?? 0;
      const room = element.clientWidth - padding;
      if (unit <= 0 || room <= 0) return;
      const whole = (1 + count) * unit + count * gap;
      if (whole <= room) {
        setFits(count);
        return;
      }
      const beside = Math.floor((room - 2 * unit - gap) / (unit + gap));
      setFits(Math.max(0, Math.min(count, beside)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bar, count]);

  return fits;
}

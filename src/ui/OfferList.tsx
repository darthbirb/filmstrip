import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";

import { SURFACE } from "./Menu";

/** One row: what a pick writes, how the row says it, and how much uses it already. */
export type OfferRow = { value: string; said: string; count?: string };

type Props = {
  /** The field's own id; each row's is this and its place. */
  id: string;
  /** The anchor name the field carries. */
  anchor: string;
  label: string;
  rows: readonly OfferRow[];
  lit: number;
  onPick: (value: string) => void;
};

/**
 * What the library has that begins with what is typed, under the field that is typing it, in the
 * top layer so nothing the field sits in cuts it off. The field keeps the keyboard. DESIGN.md "Components".
 */
export function OfferList({ id, anchor, label, rows, lit, onPick }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const showing = rows.length > 0;
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    if (showing && !element.matches(":popover-open")) element.showPopover();
    if (!showing && element.matches(":popover-open")) element.hidePopover();
  }, [showing]);

  return (
    <div
      ref={list}
      id={`${id}-offers`}
      popover="manual"
      role="listbox"
      aria-label={label}
      style={
        {
          positionAnchor: anchor,
          top: "anchor(bottom)",
          left: "anchor(left)",
          positionTryFallbacks: "flip-block",
        } as CSSProperties
      }
      className={`${SURFACE} mt-1.5 w-52`}
    >
      {rows.map((row, at) => (
        <div
          key={row.value}
          id={`${id}-${at}`}
          role="option"
          aria-selected={at === lit}
          tabIndex={-1}
          // The field keeps the keyboard while a row is picked with the pointer.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(row.value)}
          onKeyDown={() => undefined}
          className="flex h-control shrink-0 items-center gap-2 rounded-nested px-2 text-fg text-ui hover:bg-raised-hi aria-selected:bg-raised-hi"
        >
          <span className="flex-1 truncate">{row.said}</span>
          {row.count && <span className="whitespace-nowrap text-fg-dim text-key">{row.count}</span>}
        </div>
      ))}
    </div>
  );
}

/** What `load` finds for a typed word, read again as the word changes and nothing for none. */
export function useOffers<T>(word: string, load: (word: string) => Promise<T[]>) {
  const [found, setFound] = useState<T[]>([]);
  useEffect(() => {
    if (!word) {
      setFound([]);
      return;
    }
    let live = true;
    load(word)
      .then((next) => live && setFound(next))
      .catch(() => live && setFound([]));
    return () => {
      live = false;
    };
  }, [word, load]);
  return found;
}

/** A field's anchor name, from its id. */
export const anchorOf = (id: string, kind: string) => `--${kind}-${id.replace(/[^\w-]/g, "")}`;

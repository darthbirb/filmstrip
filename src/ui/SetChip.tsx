import { type CSSProperties, type KeyboardEvent, useId, useRef } from "react";

import { pillGround } from "./Chip";
import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";
import { anchorOf } from "./OfferList";

type Props = {
  value: string;
  /** A label's key; a label is a folder's, so it always sits sunk. */
  tagKey?: string | null;
  /** Given by a folder above rather than held by the files themselves. */
  inherited?: boolean;
  /** A folder's name, led by the folder glyph. */
  name?: boolean;
  /** How many of the set carry it, as "3 of 5", when not all of them do. */
  count?: string;
  /** What the pointer is told: whose it is, or the whole of a name too long to show. */
  title?: string;
  /** The keyboard stops here, and the title shows on focus as it does under the pointer. */
  stop?: boolean;
  /** Gives it to the rest of the set: a + under the pointer, and Enter. */
  add?: { label: string; onAdd: () => void };
  /** Takes it off every file holding it: a × under the pointer, and Delete. */
  remove?: { label: string; onRemove: () => void };
  /** The one a value being typed repeats, outlined while the field refuses it. */
  echoed?: boolean;
};

/**
 * A tag or label across a set of files, as the set's Tag… sheet lists it: the chip's own shape with
 * how many carry it after the name. It never searches. DESIGN.md "Components".
 */
export function SetChip({
  value,
  tagKey,
  inherited = false,
  name = false,
  count,
  title,
  stop = false,
  add,
  remove,
  echoed = false,
}: Props) {
  const id = useId();
  const anchor = anchorOf(id, "set-chip");
  const tip = useRef<HTMLSpanElement>(null);
  const said = title ?? value;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && add) {
      event.preventDefault();
      add.onAdd();
    } else if ((event.key === "Delete" || event.key === "Backspace") && remove) {
      event.preventDefault();
      remove.onRemove();
    }
  };
  const figure = count && (
    <span className="shrink-0 whitespace-nowrap pl-0.5 text-fg-dim text-key tabular-nums">
      {count}
    </span>
  );
  const acts = add || remove;
  const parts = tagKey ? (
    <>
      <span className="flex shrink-0 items-center bg-well px-2 text-fg-dim">{tagKey}</span>
      <span className="flex min-w-0 items-center gap-1.25 bg-inset px-2 text-fg-dim">
        <span className="truncate">{value}</span>
        {figure}
      </span>
    </>
  ) : (
    <>
      {name && <Glyph name="folderName" className="shrink-0 text-glyph-small" />}
      <span className="truncate">{value}</span>
      {figure}
    </>
  );
  const body = tagKey
    ? "flex h-full min-w-0"
    : `flex h-full min-w-0 items-center gap-1.25 rounded-full pr-2.5 ${name ? "pl-2" : "pl-2.5"} ${acts ? "group-hover:pr-0 group-has-focus-visible:pr-0" : ""}`;
  const face = stop ? (
    <button
      type="button"
      data-stop
      aria-label={`${tagKey ? `${tagKey}: ` : ""}${value}${count ? `, ${count}` : ""}`}
      aria-describedby={title ? `${id}-tip` : undefined}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const element = tip.current;
        if (element && event.currentTarget.matches(":focus-visible")) element.showPopover();
      }}
      onBlur={() => {
        if (tip.current?.matches(":popover-open")) tip.current.hidePopover();
      }}
      className={`${body} cursor-default outline-none`}
    >
      {parts}
    </button>
  ) : (
    <span className={body}>{parts}</span>
  );
  const shape = tagKey
    ? `overflow-hidden rounded-nested ${echoed ? "ring-1 ring-line-strong" : ""}`
    : `items-center rounded-full inset-ring hover:bg-raised-hi hover:text-fg hover:inset-ring-line-strong ${pillGround(inherited, echoed)}`;

  const chip = (
    <span
      title={said}
      style={{ anchorName: anchor } as CSSProperties}
      className={`group focus-ring-within inline-flex h-chip min-w-0 max-w-full shrink-0 text-small ${shape}`}
    >
      {face}
      {acts && (
        <span className="hidden shrink-0 items-center gap-1.25 pr-1 pl-1.25 group-hover:flex group-has-focus-visible:flex">
          {add && <Act glyph="plus" label={add.label} onClick={add.onAdd} />}
          {remove && <Act glyph="close" label={remove.label} onClick={remove.onRemove} />}
        </span>
      )}
    </span>
  );
  if (!stop || !title) return chip;
  return (
    <>
      {chip}
      <span
        ref={tip}
        id={`${id}-tip`}
        popover="manual"
        role="tooltip"
        style={
          {
            positionAnchor: anchor,
            bottom: "anchor(top)",
            left: "anchor(left)",
            positionTryFallbacks: "flip-block",
          } as CSSProperties
        }
        className="inset-auto m-0 mb-tile-gap max-w-menu rounded-nested border-0 bg-panel px-2 py-1 text-fg text-small shadow-overlay inset-ring inset-ring-line-control"
      >
        {title}
      </span>
    </>
  );
}

/** The + or ×, the pointer's: the keyboard has Enter and Delete, so the chip stays one stop. */
function Act({ glyph, label, onClick }: { glyph: GlyphName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-chip-remove shrink-0 cursor-default place-items-center rounded-full text-fg-mid text-glyph-small hover:bg-wash hover:text-fg"
    >
      <Glyph name={glyph} />
    </button>
  );
}

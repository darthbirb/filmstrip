import { Fragment, type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";
import { type MenuAnchor, placement, SURFACE } from "./Menu";

export type PickerRow = {
  id: number;
  label: string;
  glyph: GlyphName;
  /** How far in the row sits, from 0. */
  depth: number;
  /** Quieter words at the row's end: where it is, or why it cannot be picked. */
  detail?: string;
  disabled?: boolean;
  /** Open or shut, for a row with rows under it; absent for one with none. */
  expanded?: boolean;
};

export type PickerSection = { heading?: string; rows: PickerRow[] };

type Props = {
  label: string;
  placeholder: string;
  anchor: MenuAnchor;
  sections: PickerSection[];
  filter: string;
  onFilter: (text: string) => void;
  onPick: (id: number) => void;
  onToggle: (id: number) => void;
  onClose: () => void;
};

/**
 * A place to send something, picked from a filtered list: a menu with a field at its head, opened
 * against what asked for it. Typing filters, the arrows move, Enter picks and Right and Left open
 * and shut a row. DESIGN.md "Components".
 */
export function Picker({
  label,
  placeholder,
  anchor,
  sections,
  filter,
  onFilter,
  onPick,
  onToggle,
  onClose,
}: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();

  const keyed = sections.map((section, index) =>
    section.rows.map((row) => ({ row, key: `${index}-${row.id}` })),
  );
  const choices = keyed.flat().filter(({ row }) => !row.disabled);
  const current = choices[Math.min(active, choices.length - 1)];

  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    back.current = "element" in anchor ? anchor.element : null;
    if (!element.matches(":popover-open")) element.showPopover();
    setAt(placement(anchor, element.getBoundingClientRect()));
  }, [anchor]);

  // Hidden until it is placed, and a hidden field cannot take the focus.
  useLayoutEffect(() => {
    if (at) field.current?.focus({ preventScroll: true });
  }, [at]);

  const pick = (id: number) => {
    back.current?.focus({ preventScroll: true });
    surface.current?.hidePopover();
    onPick(id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      setActive(Math.max(0, Math.min(choices.length - 1, active + step)));
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      pick(current.row.id);
    } else if (
      current?.row.expanded !== undefined &&
      ((event.key === "ArrowRight" && !current.row.expanded) ||
        (event.key === "ArrowLeft" && current.row.expanded))
    ) {
      event.preventDefault();
      onToggle(current.row.id);
    } else if (event.key === "Escape") {
      // Escape closes the picker and nothing else: full screen listens on the window.
      event.stopPropagation();
    }
  };

  return (
    <div
      ref={surface}
      popover="auto"
      role="dialog"
      aria-label={label}
      onToggle={(event) => {
        if (event.newState !== "closed") return;
        if (surface.current?.contains(document.activeElement)) back.current?.focus();
        onClose();
      }}
      style={at ? { position: "fixed", ...at } : { position: "fixed", visibility: "hidden" }}
      className={`${SURFACE} max-h-[calc(100dvh-2*var(--spacing-tile-inset))]`}
    >
      <label className="relative mx-0.5 mt-0.5 mb-1.5 flex shrink-0">
        <span className="sr-only">{placeholder}</span>
        <Glyph
          name="search"
          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-dim text-glyph"
        />
        <input
          ref={field}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={current ? `${listId}-${current.key}` : undefined}
          value={filter}
          onChange={(event) => {
            setActive(0);
            onFilter(event.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="focus-ring h-control w-full min-w-0 rounded-nested bg-ground pr-2 pl-7 text-fg text-ui inset-ring inset-ring-line-control placeholder:text-fg-dim"
        />
      </label>
      <div
        id={listId}
        role="listbox"
        aria-label={label}
        className="flex min-h-0 flex-col gap-px overflow-y-auto"
      >
        {keyed.map((rows, index) => (
          <Fragment key={sections[index]?.heading ?? `section-${index}`}>
            {index > 0 && <hr className="mx-2 my-1 h-px shrink-0 border-0 bg-line" />}
            {sections[index]?.heading && (
              <p className="m-0 flex h-chip shrink-0 items-center px-2 text-eyebrow text-fg-dim uppercase">
                {sections[index]?.heading}
              </p>
            )}
            {rows.map(({ row, key }) => (
              <div
                key={key}
                id={`${listId}-${key}`}
                role="option"
                // The field keeps the focus and names the active row; a row is never tabbed to.
                tabIndex={-1}
                aria-selected={key === current?.key}
                aria-disabled={row.disabled || undefined}
                onKeyDown={onKeyDown}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!row.disabled) pick(row.id);
                }}
                className={`flex h-control shrink-0 items-center gap-2 rounded-nested pr-2 text-ui ${
                  row.disabled
                    ? "text-fg-faint"
                    : `cursor-default text-fg hover:bg-raised-hi ${key === current?.key ? "bg-raised-hi" : ""}`
                }`}
                style={{
                  paddingLeft: `calc(var(--spacing-chevron) * ${row.depth} + var(--spacing))`,
                }}
              >
                <span
                  className="grid size-chevron shrink-0 place-items-center text-fg-dim text-glyph"
                  onClick={(event) => {
                    if (row.expanded === undefined) return;
                    event.stopPropagation();
                    onToggle(row.id);
                  }}
                  aria-hidden
                >
                  {row.expanded !== undefined && (
                    <Glyph name={row.expanded ? "chevronDown" : "chevronRight"} />
                  )}
                </span>
                <Glyph
                  name={row.glyph}
                  filled
                  className={`shrink-0 text-glyph ${row.disabled ? "" : "text-fg-dim"}`}
                />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {row.detail && (
                  <span
                    className={`shrink-0 whitespace-nowrap text-small ${row.disabled ? "" : "text-fg-dim"}`}
                  >
                    {row.detail}
                  </span>
                )}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

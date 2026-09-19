import { Fragment, type KeyboardEvent, useRef, useState } from "react";

import { formatCount } from "../lib/format";
import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

export type TreeRow = {
  id: string;
  label: string;
  /** Depth, from 1. */
  level: number;
  expandable: boolean;
  expanded?: boolean;
  glyph?: GlyphName;
  /** How many items the row's own place holds; none at all shows no pill. */
  count?: number;
  /** Muted words at the row's end, where a count would be: why the row is muted. */
  detail?: string;
  muted?: boolean;
  /** Set apart from the rows above it by a rule. */
  separated?: boolean;
  /** One thing the row can do, resting at its end: its own tab stop after the row. */
  action?: { glyph: GlyphName; label: string; onClick: () => void };
};

type Props = {
  label: string;
  rows: TreeRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
};

/** An ARIA tree: one tab stop, arrows to move, Right and Left to open and close, Enter to go. */
export function Tree({ label, rows, selectedId, onSelect, onExpand, onCollapse }: Props) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const has = (id: string | null) => id !== null && rows.some((row) => row.id === id);
  const tabStop = has(focusId) ? focusId : has(selectedId) ? selectedId : (rows[0]?.id ?? null);

  const focus = (id: string | undefined) => {
    if (id === undefined) return;
    setFocusId(id);
    elements.current.get(id)?.focus();
  };

  const parentOf = (index: number) => {
    const level = rows[index]?.level ?? 1;
    for (let at = index - 1; at >= 0; at--) {
      if ((rows[at]?.level ?? 1) < level) return rows[at]?.id;
    }
    return undefined;
  };

  const toggle = (row: TreeRow) => (row.expanded ? onCollapse(row.id) : onExpand(row.id));

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const row = rows[index];
    if (!row) return;
    const next = rows[index + 1];
    switch (event.key) {
      case "ArrowDown":
        focus(next?.id);
        break;
      case "ArrowUp":
        focus(rows[index - 1]?.id);
        break;
      case "Home":
        focus(rows[0]?.id);
        break;
      case "End":
        focus(rows.at(-1)?.id);
        break;
      case "ArrowRight":
        if (row.expandable && !row.expanded) onExpand(row.id);
        else if (row.expanded && next && next.level > row.level) focus(next.id);
        break;
      case "ArrowLeft":
        if (row.expanded) onCollapse(row.id);
        else if (row.level > 1) focus(parentOf(index));
        break;
      case "Enter":
      case " ":
        onSelect(row.id);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div role="tree" aria-label={label} className="flex flex-col gap-row-gap py-2">
      {rows.map((row, index) => {
        const selected = row.id === selectedId;
        // A selected row is a filled plate; its hover washes over the plate rather than replacing it.
        const tone = selected
          ? "bg-plate text-on-plate hover-wash"
          : `${row.muted ? "text-fg-dim" : "text-fg-mid"} hover:bg-wash hover:text-fg`;
        const quiet = selected ? "text-on-plate" : "text-fg-dim";
        const ink = row.muted && !selected ? "text-fg-faint" : quiet;
        return (
          <Fragment key={row.id}>
            {row.separated && (
              <span aria-hidden="true" className="mx-row-inset my-1.5 h-px shrink-0 bg-line" />
            )}
            <div
              ref={(element) => {
                if (element) elements.current.set(row.id, element);
                else elements.current.delete(row.id);
              }}
              role="treeitem"
              // Named explicitly, so a trailing action's own label is not read as the row's.
              aria-label={[
                row.label,
                row.count === undefined ? null : formatCount(row.count),
                row.detail,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-level={row.level}
              aria-expanded={row.expandable ? Boolean(row.expanded) : undefined}
              aria-selected={selected}
              tabIndex={row.id === tabStop ? 0 : -1}
              onClick={(event) => {
                setFocusId(row.id);
                const onChevron = (event.target as Element).closest("[data-chevron]");
                if (onChevron && row.expandable) toggle(row);
                else onSelect(row.id);
              }}
              onDoubleClick={() => {
                if (row.expandable) toggle(row);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`focus-ring mx-row-inset flex h-row shrink-0 cursor-default select-none items-center gap-2 rounded-control pr-2 pl-1 text-row transition-colors duration-(--motion-quick) motion-reduce:transition-none ${tone}`}
            >
              <span
                aria-hidden="true"
                className="shrink-0"
                style={{ width: `calc(var(--spacing-indent) * ${row.level - 1})` }}
              />
              <span
                data-chevron
                aria-hidden="true"
                className={`flex size-chevron shrink-0 items-center justify-center ${quiet}`}
              >
                {row.expandable && (
                  <Glyph
                    name={row.expanded ? "chevronDown" : "chevronRight"}
                    className="text-glyph"
                  />
                )}
              </span>
              {/* Filled, so a row reads as a thing; a control's outlined glyph reads as an action. */}
              {row.glyph && <Glyph name={row.glyph} filled className={`text-icon ${ink}`} />}
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.count !== undefined && (
                <span
                  className={`flex h-badge shrink-0 items-center rounded-badge px-1.5 text-small tabular-nums ${selected ? "bg-on-plate-wash text-on-plate" : "bg-raised text-fg-mid inset-ring inset-ring-line-control"}`}
                >
                  {formatCount(row.count)}
                </span>
              )}
              {row.detail && (
                <span
                  className={`shrink-0 text-small tabular-nums ${selected ? "text-on-plate-dim" : "text-fg-dim"}`}
                >
                  {row.detail}
                </span>
              )}
              {/* Drawn at rest rather than on hover: a pointer is not the only way here. */}
              {row.action && (
                <button
                  type="button"
                  aria-label={row.action.label}
                  title={row.action.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    row.action?.onClick();
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className={`focus-ring -mr-1 grid size-chip shrink-0 place-items-center rounded-nested text-glyph transition-colors duration-(--motion-quick) motion-reduce:transition-none ${
                    selected
                      ? "text-on-plate-dim hover:bg-on-plate-wash hover:text-on-plate"
                      : "text-fg-dim hover:bg-wash hover:text-fg"
                  }`}
                >
                  <Glyph name={row.action.glyph} />
                </button>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

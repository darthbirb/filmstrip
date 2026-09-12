import { type KeyboardEvent, useRef, useState } from "react";

import { GLYPHS, type Glyph } from "./glyphs";

export type TreeRow = {
  id: string;
  label: string;
  /** Depth, from 1. */
  level: number;
  expandable: boolean;
  expanded?: boolean;
  glyph?: Glyph;
  /** Muted text at the row's end: a count, or why the row is muted. */
  detail?: string;
  muted?: boolean;
  /** Set apart from the row above it. */
  separated?: boolean;
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
    <div role="tree" aria-label={label} className="flex flex-col py-1">
      {rows.map((row, index) => (
        <div
          key={row.id}
          ref={(element) => {
            if (element) elements.current.set(row.id, element);
            else elements.current.delete(row.id);
          }}
          role="treeitem"
          aria-level={row.level}
          aria-expanded={row.expandable ? Boolean(row.expanded) : undefined}
          aria-selected={row.id === selectedId}
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
          className={`focus-ring flex h-row shrink-0 cursor-default select-none items-center gap-1 pr-2 pl-1 text-ui transition-colors duration-(--motion-quick) motion-reduce:transition-none ${row.id === selectedId ? "bg-selected text-fg" : "hover:bg-hover"} ${row.muted ? "text-fg-muted" : ""} ${row.separated ? "mt-3" : ""}`}
        >
          <span
            aria-hidden="true"
            className="shrink-0"
            style={{ width: `calc(var(--spacing-indent) * ${row.level - 1})` }}
          />
          <span
            data-chevron
            aria-hidden="true"
            className="flex size-chevron shrink-0 items-center justify-center font-glyph text-glyph text-fg-muted"
          >
            {row.expandable ? GLYPHS[row.expanded ? "chevronDown" : "chevronRight"] : null}
          </span>
          {row.glyph && (
            <span aria-hidden="true" className="shrink-0 font-glyph text-icon text-fg-muted">
              {GLYPHS[row.glyph]}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate pl-1">{row.label}</span>
          {row.detail && (
            <span className="shrink-0 text-caption text-fg-muted tabular-nums">{row.detail}</span>
          )}
        </div>
      ))}
    </div>
  );
}

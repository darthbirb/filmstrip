import { Fragment, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { formatCount } from "../lib/format";
import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";
import { type HeadedMenu, useContextMenu } from "./Menu";

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
  /** A row's right-click menu; an empty one opens nothing. */
  menuFor?: (id: string) => HeadedMenu;
  /** The row whose name is a field for now, and what becomes of what is typed there. */
  renaming?: Renaming | null;
};

export type Renaming = { id: string; onCommit: (name: string) => void; onCancel: () => void };

/** An ARIA tree: one tab stop, arrows to move, Right and Left to open and close, Enter to go. */
export function Tree({
  label,
  rows,
  selectedId,
  onSelect,
  onExpand,
  onCollapse,
  menuFor,
  renaming,
}: Props) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const context = useContextMenu();
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
              onContextMenu={(event) => {
                if (!menuFor) return;
                const { heading, groups } = menuFor(row.id);
                context.open(event, row.label, groups, heading);
              }}
              className={`focus-ring mx-row-inset flex h-row shrink-0 cursor-default items-center gap-2 rounded-control pr-2 pl-1 text-row transition-colors duration-(--motion-quick) motion-reduce:transition-none ${tone}`}
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
              {renaming?.id === row.id ? (
                <NameField
                  name={row.label}
                  renaming={renaming}
                  onDone={() => elements.current.get(row.id)?.focus()}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
              )}
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
      {context.menu}
    </div>
  );
}

/**
 * The row's name as a field, where it stands: the whole name selected, Enter or leaving it keeps
 * what was typed, Escape keeps the old name. DECISIONS.md "Right-click menus".
 */
function NameField({
  name,
  renaming,
  onDone,
}: {
  name: string;
  renaming: Renaming;
  onDone: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    field.current?.select();
  }, []);

  const settle = (keep: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const typed = field.current?.value.trim() ?? "";
    if (keep && typed && typed !== name) renaming.onCommit(typed);
    else renaming.onCancel();
  };

  return (
    <input
      ref={field}
      aria-label={`Rename ${name}`}
      defaultValue={name}
      onBlur={() => settle(true)}
      // The row's own keys and clicks are the tree's; in here they are the field's.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        settle(event.key === "Enter");
        onDone();
      }}
      className="focus-ring h-chip min-w-0 flex-1 rounded-nested bg-well px-1.5 text-fg inset-ring inset-ring-line-strong selection:bg-plate selection:text-on-plate"
    />
  );
}

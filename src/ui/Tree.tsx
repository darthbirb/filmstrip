import { Fragment, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import { formatCount } from "../lib/format";
import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";
import { type HeadedMenu, useContextMenu } from "./Menu";
import { PushDown } from "./PushDown";

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
  /** Quieter words right after the name, as a favourite says which folder it is in. */
  note?: string;
  /** Muted words at the row's end, where a count would be: why the row is muted. */
  detail?: string;
  muted?: boolean;
  /** Set apart from the rows above it by a rule. */
  separated?: boolean;
  /** Where you are too, as a favourite's row is beside its own: plated, as the selected row is. */
  here?: boolean;
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
  /** The row a dragged ghost rests on and that will take it: lifted inside a pewter ring. */
  accepting?: string | null;
};

export type Renaming = {
  id: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  /** Why the name typed cannot be used, said under the row until the name is edited. */
  taken?: string | null;
  onEdit?: () => void;
  /** A row not made yet, whose name as it stands is one to make rather than one to keep. */
  fresh?: boolean;
};

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
  accepting,
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
        const selected = row.id === selectedId || Boolean(row.here);
        // A selected row is a filled plate; its hover washes over the plate rather than replacing it.
        // A row about to take a drop wears the selection's colour as a ring: it is about to be chosen.
        const tone =
          row.id === accepting
            ? "bg-wash text-fg inset-ring-2 inset-ring-plate"
            : selected
              ? "bg-plate text-on-plate hover-wash"
              : `${row.muted ? "text-fg-dim" : "text-fg-mid"} hover:bg-wash hover:text-fg`;
        const quiet = selected ? "text-on-plate" : "text-fg-dim";
        const ink =
          row.id === accepting ? "text-fg" : row.muted && !selected ? "text-fg-faint" : quiet;
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
              // Where a drag finds which row it rests on.
              data-row={row.id}
              // Named explicitly, so a trailing action's own label is not read as the row's.
              aria-label={[
                row.label,
                row.count === undefined ? null : formatCount(row.count),
                row.detail,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-description={row.note}
              aria-level={row.level}
              aria-expanded={row.expandable ? Boolean(row.expanded) : undefined}
              aria-selected={row.id === selectedId}
              aria-current={row.here ? "location" : undefined}
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
                  id={row.id}
                  name={row.label}
                  renaming={renaming}
                  // A draft row that was never made has no row left; its parent has.
                  onDone={() => {
                    const to =
                      elements.current.get(row.id) ?? elements.current.get(parentOf(index) ?? "");
                    to?.focus();
                  }}
                />
              ) : row.note ? (
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
                  <span className="truncate">{row.label}</span>
                  <span className={`shrink-0 text-small ${quiet}`}>{row.note}</span>
                </span>
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
            {renaming?.id === row.id && (
              // Tight under its row: the tree's own gap would open before the reason does.
              <PushDown open={Boolean(renaming.taken)} className="mx-row-inset -mt-row-gap">
                {/* Under the name, so the reason reads as the field's own. */}
                <p className="m-0 flex gap-2 pr-2 pb-1 pl-1 text-fg-dim text-small">
                  <span
                    aria-hidden="true"
                    className="shrink-0"
                    style={{ width: `calc(var(--spacing-indent) * ${row.level - 1})` }}
                  />
                  <span aria-hidden="true" className="size-chevron shrink-0" />
                  {row.glyph && (
                    <Glyph name={row.glyph} filled className="invisible shrink-0 text-icon" />
                  )}
                  <span id={`${row.id}-taken`} className="min-w-0 flex-1 px-1.5">
                    {renaming.taken}
                  </span>
                </p>
              </PushDown>
            )}
          </Fragment>
        );
      })}
      {context.menu}
    </div>
  );
}

/**
 * The row's name as a field, where it stands: the whole name selected, Enter or leaving it keeps
 * what was typed, Escape keeps the old name. A name taken holds Enter until it is edited, and
 * leaving then keeps the old one. DECISIONS.md "Right-click menus".
 */
function NameField({
  id,
  name,
  renaming,
  onDone,
}: {
  id: string;
  name: string;
  renaming: Renaming;
  onDone: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const taken = renaming.taken ?? null;
  useEffect(() => {
    field.current?.select();
  }, []);
  // The answer to Enter came back taken: the keyboard is where the name gets mended.
  useEffect(() => {
    if (taken) field.current?.focus();
  }, [taken]);
  // Closing a field that had the focus hands it back to the row, not to the page.
  const done = useRef(onDone);
  done.current = onDone;
  // A layout effect, so it runs before the field leaves the page and still sees the focus.
  useLayoutEffect(() => {
    const element = field.current;
    return () => {
      if (!element || document.activeElement !== element) return;
      queueMicrotask(() => {
        if (!element.isConnected) done.current();
      });
    };
  }, []);

  // Once committed, the field waits for the answer; a new edit lets it be committed again.
  const commit = () => {
    if (settled.current || taken) return;
    settled.current = true;
    const typed = field.current?.value.trim() ?? "";
    if (typed && (renaming.fresh || typed !== name)) renaming.onCommit(typed);
    else renaming.onCancel();
  };
  const cancel = () => {
    settled.current = true;
    renaming.onCancel();
  };

  return (
    <input
      ref={field}
      aria-label={renaming.fresh ? "Folder Name" : `Rename ${name}`}
      aria-invalid={taken !== null}
      aria-describedby={taken ? `${id}-taken` : undefined}
      defaultValue={name}
      onChange={() => {
        settled.current = false;
        renaming.onEdit?.();
      }}
      onBlur={() => (taken ? cancel() : commit())}
      // The row's own keys and clicks are the tree's; in here they are the field's.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      className="focus-ring h-chip min-w-0 flex-1 rounded-nested bg-well px-1.5 text-fg inset-ring inset-ring-line-strong selection:bg-plate selection:text-on-plate aria-invalid:inset-ring-line-danger"
    />
  );
}

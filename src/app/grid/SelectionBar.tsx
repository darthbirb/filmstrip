import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { copyItems } from "../../ipc/commands";
import { formatBytes, formatCount } from "../../lib/format";
import { Button } from "../../ui/Button";
import { DismissButton } from "../../ui/DismissButton";
import { Menu, type MenuAction } from "../../ui/Menu";
import { PushDown } from "../../ui/PushDown";
import { setFavourites, useEveryFavourite } from "../favourites";
import { deleteFiles } from "../pane/delete";
import { openMovePicker } from "../pane/move-picker";
import { restoreFiles } from "../pane/restore";
import { usePlace } from "../place";
import { checkAll, clearChecked, useChecked } from "./selection";

/**
 * What acts on the files checked in the grid: a row of the grid's own column, under the pictures
 * and never over them, there while anything is checked. Artboards › Selecting.
 */
export function SelectionBar() {
  const rows = useChecked();
  const trash = usePlace()?.kind === "trash";
  // The set it last showed stays in it while it folds away, so its words do not blank as it goes.
  const last = useRef(rows);
  if (rows.length > 0) last.current = rows;
  const shown = last.current;
  return (
    <PushDown open={rows.length > 0}>
      {shown.length > 0 && (trash ? <InTrash rows={shown} /> : <InLibrary rows={shown} />)}
    </PushDown>
  );
}

// The line is drawn twice, once out of sight to be measured, so no piece holds a ref.
type Piece = { id: string; node: ReactNode; action?: MenuAction; group?: number };

const files = (count: number) => `${formatCount(count)} ${count === 1 ? "File" : "Files"}`;

/** The one folder the set is in, or none when it spans several. */
function oneFolder(rows: readonly ItemRow[]) {
  const [first, ...rest] = rows;
  return first && rest.every((row) => row.folderId === first.folderId) ? first.folderId : null;
}

function InLibrary({ rows }: { rows: readonly ItemRow[] }) {
  const ids = rows.map((row) => row.id);
  const favourite = useEveryFavourite(rows);
  const star = favourite ? "Remove Favourite" : "Favourite";
  const remove = `Delete ${files(ids.length)}`;
  const run = {
    favourite: () => setFavourites(ids, !favourite),
    copy: () => void copyItems(ids).catch(() => undefined),
    delete: () => void deleteFiles(ids),
  };
  // Written in the bar's order; `sheds` is the order they leave it for More.
  const pieces: Piece[] = [
    {
      id: "favourite",
      group: 1,
      node: (
        <Button glyph="star" filled={favourite} onClick={run.favourite}>
          {star}
        </Button>
      ),
      action: {
        id: "favourite",
        label: star,
        glyph: "star",
        filled: favourite,
        onSelect: run.favourite,
      },
    },
    {
      id: "move",
      node: (
        <Button
          glyph="moveTo"
          onClick={(event) =>
            openMovePicker({
              itemIds: ids,
              folderId: oneFolder(rows),
              anchor: { element: event.currentTarget },
            })
          }
        >
          Move to…
        </Button>
      ),
    },
    {
      id: "copy",
      group: 1,
      node: (
        <Button glyph="copy" onClick={run.copy}>
          Copy
        </Button>
      ),
      action: { id: "copy", label: "Copy", glyph: "copy", onSelect: run.copy },
    },
    {
      id: "rule",
      node: <span aria-hidden="true" className="mx-0.5 h-badge w-px shrink-0 bg-line-control" />,
    },
    {
      id: "delete",
      group: 2,
      node: (
        <Button tone="danger" glyph="trash" onClick={run.delete}>
          {remove}
        </Button>
      ),
      action: { id: "delete", label: remove, glyph: "trash", tone: "danger", onSelect: run.delete },
    },
  ];
  return (
    <Bar rows={rows} pieces={pieces} sheds={["size", "selectAll", "copy", "favourite", "delete"]} />
  );
}

/** In the Trash the way back is all a set can do, as its pane's bar has it. */
function InTrash({ rows }: { rows: readonly ItemRow[] }) {
  const ids = rows.map((row) => row.id);
  const pieces: Piece[] = [
    {
      id: "restore",
      node: (
        <Button glyph="putBack" onClick={() => void restoreFiles(ids)}>
          Restore
        </Button>
      ),
    },
    {
      id: "restoreTo",
      node: (
        <Button
          glyph="moveTo"
          onClick={(event) =>
            openMovePicker({
              restoring: ids,
              folderId: oneFolder(rows),
              anchor: { element: event.currentTarget },
            })
          }
        >
          Restore to…
        </Button>
      ),
    },
  ];
  return <Bar rows={rows} pieces={pieces} sheds={["size", "selectAll"]} />;
}

type BarProps = { rows: readonly ItemRow[]; pieces: Piece[]; sheds: string[] };

/**
 * The count and its size, Select All, the set's verbs, and the clear. What has no room leaves for
 * More in a fixed order; the count, Move to… and the clear never leave. Measured, never guessed.
 */
function Bar({ rows, pieces, sheds }: BarProps) {
  const bar = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const bytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
  const selectAll: MenuAction = {
    id: "selectAll",
    label: "Select All",
    glyph: "checkAll",
    onSelect: () => checkAll(),
  };
  const labels = pieces.map((piece) => piece.action?.label ?? piece.id).join("\n") + rows.length;
  const shed = useShed(bar, copy, sheds, labels);
  const gone = new Set(sheds.slice(0, shed));
  // The rule stands before Delete, so it goes with it.
  if (gone.has("delete")) gone.add("rule");

  const line = (measured: boolean) => [
    <span
      key="count"
      data-piece="count"
      className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap pr-1 tabular-nums"
    >
      <span className="font-semibold text-fg text-ui">{files(rows.length)}</span>
      {(measured || !gone.has("size")) && (
        <span data-piece="size" className="text-fg-dim text-small">
          {formatBytes(bytes)}
        </span>
      )}
    </span>,
    (measured || !gone.has("selectAll")) && (
      <span key="selectAll" data-piece="selectAll" className="contents">
        <Button glyph="checkAll" title="Select All · Ctrl+A" onClick={() => checkAll()}>
          Select All
        </Button>
      </span>
    ),
    <span key="spacer" data-piece="spacer" className="min-w-2 flex-1" />,
    ...pieces
      .filter((piece) => measured || !gone.has(piece.id))
      .map((piece) => (
        <span key={piece.id} data-piece={piece.id} className="contents">
          {piece.node}
        </span>
      )),
  ];

  // Select All, then a rule, then the verbs by their groups, as the drawing's More holds them.
  const folded: MenuAction[][] = [gone.has("selectAll") ? [selectAll] : []];
  for (const group of [1, 2]) {
    folded.push(
      pieces.flatMap((piece) =>
        piece.group === group && gone.has(piece.id) && piece.action ? [piece.action] : [],
      ),
    );
  }

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Selection"
      className="relative flex h-toolbar items-center gap-1.5 overflow-hidden border-line border-t bg-panel pr-1.5 pl-3"
    >
      {/* The whole line as it would be drawn, out of sight, so what leaves is measured. */}
      <div
        ref={copy}
        inert
        aria-hidden
        className="invisible absolute flex w-max items-center gap-1.5"
      >
        {line(true)}
        <span data-piece="more" className="contents">
          <Menu label="More" glyph="more" groups={[]} />
        </span>
        <DismissButton label="Clear Selection" onClick={() => undefined} />
      </div>
      {line(false)}
      {shed > 0 && <Menu label="More" glyph="more" groups={folded} />}
      <DismissButton label="Clear Selection" title="Clear Selection · Esc" onClick={clearChecked} />
    </div>
  );
}

/** How many of `sheds` have no room, in their order, measured against the bar's own width. */
function useShed(
  bar: RefObject<HTMLElement | null>,
  copy: RefObject<HTMLElement | null>,
  sheds: readonly string[],
  labels: string,
) {
  const [shed, setShed] = useState(0);
  const order = sheds.join(" ");

  useLayoutEffect(() => {
    const element = bar.current;
    const drawn = copy.current;
    // Measured again whenever the words change, since the words are what take the room.
    if (!element || !drawn || labels === "") return;
    const leaving = order.split(" ");
    const measure = () => {
      const style = getComputedStyle(element);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const room =
        element.clientWidth -
        (Number.parseFloat(style.paddingLeft) || 0) -
        (Number.parseFloat(style.paddingRight) || 0);
      if (room <= 0) return;
      const width = new Map<string, number>();
      for (const piece of drawn.querySelectorAll<HTMLElement>("[data-piece]")) {
        // A `contents` wrapper has no box of its own; its button does.
        const box = piece.classList.contains("contents") ? piece.firstElementChild : piece;
        width.set(piece.dataset.piece ?? "", box?.getBoundingClientRect().width ?? 0);
      }
      const clear = drawn.lastElementChild?.getBoundingClientRect().width ?? 0;
      const needs = (n: number) => {
        const gone = new Set(leaving.slice(0, n));
        if (gone.has("delete")) gone.add("rule");
        // The size sits inside the count's box, so it comes off the count rather than standing alone.
        let sum =
          clear +
          (width.get("count") ?? 0) -
          (gone.has("size") ? (width.get("size") ?? 0) + gap : 0);
        let boxes = 2;
        for (const [piece, w] of width) {
          if (piece === "count" || piece === "size" || piece === "more" || gone.has(piece))
            continue;
          sum += w;
          boxes += 1;
        }
        if (n > 0) {
          sum += width.get("more") ?? 0;
          boxes += 1;
        }
        return sum + gap * (boxes - 1);
      };
      let n = 0;
      while (n < leaving.length && needs(n) > room) n += 1;
      setShed(n);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bar, copy, order, labels]);

  return shed;
}

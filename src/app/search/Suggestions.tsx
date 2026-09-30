import { type CSSProperties, Fragment, useLayoutEffect, useRef } from "react";

import type { Suggestion } from "../../ipc/bindings/Suggestion";
import type { SuggestionKind } from "../../ipc/bindings/SuggestionKind";
import { Glyph } from "../../ui/Glyph";
import type { GlyphName } from "../../ui/glyphs";
import { TermChip } from "../../ui/TermChip";

const KINDS: Record<SuggestionKind, { glyph: GlyphName; filled?: boolean; word: string }> = {
  words: { glyph: "words", word: "Words" },
  folder: { glyph: "folder", filled: true, word: "Folder" },
  tag: { glyph: "tag", word: "Tag" },
  label: { glyph: "label", word: "Label" },
};

type Props = {
  id: string;
  /** The field's anchor name: the list hangs under it, at its width. */
  anchor: string;
  rows: readonly Suggestion[];
  /** The words in the field, which the Words row runs as they are. */
  typed: string;
  /** The row ↓ and ↑ stand on; none until one of them is pressed. */
  plate: number | null;
  onPick: (row: Suggestion) => void;
};

/** What a row writes, drawn as the field will show it once it is written. */
function Term({ row, typed }: { row: Suggestion; typed: string }) {
  if (row.kind === "folder") {
    return (
      <>
        {row.path.length > 1 && (
          <span className="min-w-0 truncate text-fg-dim">
            {row.path.slice(0, -1).join(" / ")} /
          </span>
        )}
        <span className="shrink-0">{row.path.at(-1)}</span>
      </>
    );
  }
  if (row.shape.kind === "text") return <span className="truncate">{typed}</span>;
  return <TermChip shape={row.shape} text={row.text} />;
}

/**
 * The list under the search field: a term a row, its kind said at the row's end. The caret stays
 * in the field, so a row is pressed or plated and never focused. Components › "The field holds the query".
 */
export function Suggestions({ id, anchor, rows, typed, plate, onPick }: Props) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    list.current?.showPopover();
  }, []);

  return (
    <div
      ref={list}
      id={id}
      popover="manual"
      role="listbox"
      aria-label="Suggestions"
      style={
        {
          positionAnchor: anchor,
          top: "anchor(bottom)",
          left: "anchor(left)",
          width: "anchor-size(width)",
        } as CSSProperties
      }
      className="m-0 mt-1 flex-col gap-px rounded-control border-0 bg-panel p-1 text-fg text-ui shadow-overlay inset-ring inset-ring-line-control open:flex"
    >
      {rows.map((row, index) => (
        <Fragment key={`${row.kind} ${row.text}`}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keys stay in the field, which plates a row and picks it. */}
          <div
            id={`${id}-${index}`}
            role="option"
            aria-selected={plate === index}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(row)}
            className={`flex h-control shrink-0 cursor-default items-center gap-2 whitespace-nowrap rounded-nested px-2 hover:bg-raised-hi ${plate === index ? "bg-raised-hi" : ""}`}
          >
            <Glyph
              name={KINDS[row.kind].glyph}
              filled={KINDS[row.kind].filled}
              className="shrink-0 text-fg-dim text-glyph"
            />
            <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              <Term row={row} typed={typed} />
            </span>
            <span className="shrink-0 text-fg-dim text-small">{KINDS[row.kind].word}</span>
          </div>
          {row.kind === "words" && rows.length > 1 && (
            <div role="presentation" className="mx-2 my-1 h-px shrink-0 bg-line" />
          )}
        </Fragment>
      ))}
    </div>
  );
}

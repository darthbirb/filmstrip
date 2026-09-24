import type { ReactNode } from "react";

import { Button } from "./Button";
import { Glyph } from "./Glyph";

type Props = {
  /** One line: what happened, counted. */
  sentence: string;
  retry?: () => void;
  /** Whether the list under the line is showing. */
  open: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  /** The list: a heading row and the rows under it, laid out by `listRow`. */
  children: ReactNode;
};

/**
 * Something only you can settle, above the grid until it is: a line, its buttons, and the files
 * it is about, in a list that opens under it. DESIGN.md "Components".
 */
export function Banner({ sentence, retry, open, onToggle, onDismiss, children }: Props) {
  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="flex flex-col rounded-control bg-panel inset-ring inset-ring-line-danger">
        <div
          className={`flex min-h-toolbar items-center gap-2.5 py-1.5 pr-2 pl-3 ${open ? "border-line border-b" : ""}`}
        >
          <Glyph name="warning" className="shrink-0 text-danger text-icon" />
          <span className="min-w-0 flex-1 text-fg text-ui tabular-nums">{sentence}</span>
          {retry && <Button onClick={retry}>Retry</Button>}
          <Button
            tone="quiet"
            expanded={open}
            detail={open && <Glyph name="chevronDown" className="rotate-180 text-glyph-small" />}
            onClick={onToggle}
          >
            {open ? "Hide Files" : "Show Files"}
          </Button>
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={onDismiss}
            className="focus-ring grid size-control shrink-0 place-items-center rounded-control text-fg-dim text-glyph transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg motion-reduce:transition-none"
          >
            <Glyph name="close" />
          </button>
        </div>
        {open && <div className="max-h-45 overflow-auto">{children}</div>}
      </div>
    </div>
  );
}

/** A list row's columns: the name, why, and a narrow end column. `end` is that column's width. */
export const listRow = (end: "badge" | "control") =>
  `grid ${end === "badge" ? "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_3.5rem]" : "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_var(--spacing-control)]"} items-center gap-3.5 px-3`;

/** The capitals over a list's columns. */
export const LIST_HEADING = "h-7 text-eyebrow text-fg-dim uppercase";

/** One row of a list. */
export const LIST_ROW = "h-control border-line border-t text-ui hover:bg-inset";

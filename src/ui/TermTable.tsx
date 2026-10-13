import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useRef,
} from "react";

import { formatCount } from "../lib/format";
import { Glyph } from "./Glyph";

/** The name, then two counts at the `count` column's width, then the row's ⋯. */
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_var(--spacing-count)_var(--spacing-count)_var(--spacing-bar-field)] items-center gap-x-4";

export type SortColumn = "name" | "files" | "folders";
export type TermSort = { by: SortColumn; dir: "asc" | "desc" };

/** Name runs A to Z first, a count most first; a second click on the same heading reverses it. */
export function nextSort(sort: TermSort, by: SortColumn): TermSort {
  if (sort.by === by) return { by, dir: sort.dir === "asc" ? "desc" : "asc" };
  return { by, dir: by === "name" ? "asc" : "desc" };
}

type GroupProps = {
  /** What the group is, for the keyboard and a screen reader. */
  label: string;
  /** What the name column holds: Tag, or Label. */
  heading: string;
  sort: TermSort;
  onSort: (sort: TermSort) => void;
  children: ReactNode;
};

/**
 * Terms in the settings' `inset` group under headings that sort it, each count in a column of its
 * own so the figures line up from row to row. DESIGN.md "Components".
 */
export function TermGroup({ label, heading, sort, onSort, children }: GroupProps) {
  const column = (by: SortColumn, label: string, end = false) => {
    const on = sort.by === by;
    return (
      <button
        type="button"
        aria-label={`Sort by ${label}`}
        aria-pressed={on}
        onClick={() => onSort(nextSort(sort, by))}
        className={`focus-ring-inset -mx-1 flex h-chip items-center gap-1 whitespace-nowrap rounded-badge px-1 text-eyebrow uppercase transition-colors duration-(--motion-quick) hover:text-fg motion-reduce:transition-none ${end ? "justify-end" : ""} ${on ? "text-fg-mid" : "text-fg-dim"}`}
      >
        {label}
        {on && (
          <Glyph
            name={sort.dir === "asc" ? "sortAscending" : "sortDescending"}
            className="text-glyph-small"
          />
        )}
      </button>
    );
  };
  return (
    <section
      aria-label={label}
      className="flex shrink-0 flex-col rounded-control bg-inset inset-ring inset-ring-line-control"
    >
      <div className={`${COLUMNS} border-line border-b py-0.5 pr-1 pl-2`}>
        <span className="flex">{column("name", heading)}</span>
        <span className="flex justify-end">{column("files", "Files", true)}</span>
        <span className="flex justify-end">{column("folders", "Folders", true)}</span>
        <span />
      </div>
      {children}
    </section>
  );
}

type RowProps = {
  /** The chip, or the field it becomes, and what is said after it. */
  name: ReactNode;
  files: number;
  folders: number;
  /** A value under its key, set in by the tree's indent. */
  nested?: boolean;
  /** The row's ⋯, or nothing for a row that has no acts. */
  more?: ReactNode;
  /** Asking on the row: a `line-danger` ring round it and the question under it. */
  asking?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

/** One term: its chip, the files carrying it and the folders holding it, and its ⋯. */
export function TermRow({ name, files, folders, nested, more, asking, onKeyDown }: RowProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys a row answers arrive from its chip, its ⋯ and its question, which the keyboard reaches.
    <div
      onKeyDown={onKeyDown}
      className={`not-first:border-line not-first:border-t ${asking ? "inset-ring inset-ring-line-danger" : ""}`}
    >
      <div
        className={`${COLUMNS} min-h-row py-1 pr-1 transition-colors duration-(--motion-quick) motion-reduce:transition-none ${nested ? "pl-indent" : "pl-2"} ${asking ? "" : "hover:bg-wash has-[[data-open]]:bg-wash"}`}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{name}</span>
        <Figure count={files} />
        <Figure count={folders} />
        <span className="flex justify-end">
          {more ?? <span aria-hidden="true" className="size-bar-field" />}
        </span>
      </div>
      {asking}
    </div>
  );
}

function Figure({ count }: { count: number }) {
  return (
    <span
      className={`whitespace-nowrap text-right text-small tabular-nums ${count === 0 ? "text-fg-faint" : "text-fg-mid"}`}
    >
      {formatCount(count)}
    </span>
  );
}

type MoreProps = {
  label: string;
  open: boolean;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  ref?: Ref<HTMLButtonElement>;
};

/** A row's ⋯: there at rest in `fg-dim`, before the pointer is, and `raised-hi` while it is open. */
export function MoreButton({ label, open, onOpen, ref }: MoreProps) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      aria-expanded={open}
      data-open={open || undefined}
      onClick={onOpen}
      className="focus-ring grid size-bar-field place-items-center rounded-nested text-fg-dim text-icon transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg aria-expanded:bg-raised-hi aria-expanded:text-fg motion-reduce:transition-none"
    >
      <Glyph name="more" />
    </button>
  );
}

type QuestionProps = {
  /** The question, the terms it names in `fg`. */
  children: ReactNode;
  /** Its answers, the one that acts first. */
  answers: ReactNode;
};

/**
 * A question on the row it is about, in the source row's remove shape: the warning glyph and the
 * question, over its answers. DESIGN.md "Components".
 */
export function RowQuestion({ children, answers }: QuestionProps) {
  const box = useRef<HTMLDivElement>(null);
  // What had the focus has just gone, so it goes to the answer that keeps: the last.
  useLayoutEffect(() => {
    const buttons = box.current?.querySelectorAll("button");
    buttons?.[buttons.length - 1]?.focus();
  }, []);
  return (
    <div ref={box} className="flex flex-col gap-2 bg-inset px-2 pt-1.5 pb-2.5">
      <p className="m-0 flex items-start gap-2 text-fg-mid text-ui text-pretty">
        <Glyph name="warning" className="shrink-0 text-danger text-icon" />
        <span className="min-w-0 flex-1">{children}</span>
      </p>
      <div className="flex gap-1.5 pl-6.5">{answers}</div>
    </div>
  );
}

import type { KeyboardEvent, ReactNode } from "react";

import { Bar } from "./Bar";

/** When it was taken and how, then its size in the `count` column, then the row's one button. */
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_var(--spacing-count)_var(--spacing-row-action)] items-center gap-x-4";

/**
 * Backups in the settings' `inset` group under their headings, the list scrolling inside it so the
 * dialog never grows. DESIGN.md "Components".
 */
export function BackupGroup({ label, children }: { label: string; children: ReactNode }) {
  const heading = "flex h-chip items-center text-eyebrow text-fg-dim uppercase";
  return (
    <section
      aria-label={label}
      className="flex min-h-0 flex-1 flex-col rounded-control bg-inset inset-ring inset-ring-line-control"
    >
      <div className={`${COLUMNS} shrink-0 border-line border-b py-0.5 pr-1 pl-2`}>
        <span className={heading}>Taken</span>
        <span className={`${heading} justify-end`}>Size</span>
        <span />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

type RowProps = {
  /** When it was taken, never cut. */
  when: string;
  /** How it was taken, or what is happening to it; the first to give way. */
  how: string;
  /** Its size, or the bar while it is being written. */
  size: ReactNode;
  /** Its button, or nothing for a row that has none. */
  action?: ReactNode;
  /** A row that will go at the next backup: its time steps back to `fg-mid`. */
  going?: boolean;
  /** Asking, or restoring, on the row: a `line-danger` ring round it and what it says under it. */
  asking?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

/** One backup: when and how it was taken, its size, and Restore…. */
export function BackupRow({ when, how, size, action, going, asking, onKeyDown }: RowProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys a row answers arrive from its button and its question, which the keyboard reaches.
    <div
      onKeyDown={onKeyDown}
      className={`not-first:border-line not-first:border-t ${asking ? "inset-ring inset-ring-line-danger" : ""}`}
    >
      <div
        className={`${COLUMNS} min-h-row py-1 pr-1 pl-2 transition-colors duration-(--motion-quick) motion-reduce:transition-none ${asking ? "" : "hover:bg-wash"}`}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={`shrink-0 whitespace-nowrap text-ui tabular-nums ${going ? "text-fg-mid" : "text-fg"}`}
          >
            {when}
          </span>
          <span title={how} className="min-w-0 truncate text-fg-dim text-small">
            {how}
          </span>
        </span>
        <span className="whitespace-nowrap text-right text-fg-mid text-small tabular-nums">
          {size}
        </span>
        <span className="flex justify-end">{action}</span>
      </div>
      {asking}
    </div>
  );
}

/** Work on the row, under it in its ring: what is happening, how far, and the bar. */
export function RowProgress({ sentence, percent }: { sentence: string; percent: number }) {
  return (
    <div className="flex flex-col gap-1.5 bg-inset px-2 pt-1.5 pb-2.5">
      <span className="flex items-baseline gap-2 text-fg-mid text-small">
        <span className="min-w-0 flex-1 truncate">{sentence}</span>
        <span className="text-fg tabular-nums">{percent}%</span>
      </span>
      <Bar percent={percent} />
    </div>
  );
}

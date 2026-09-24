import type { ReactNode } from "react";

export type Row = { label: string; control: ReactNode };

/** A section's caption: what the rows under it are about. */
export function Caption({ children }: { children: ReactNode }) {
  return <h3 className="m-0 pl-0.5 text-eyebrow text-fg-dim uppercase">{children}</h3>;
}

/** Settings as rows in an `inset` group, each a label and its control. DESIGN.md "Components". */
export function Rows({ rows }: { rows: readonly Row[] }) {
  return (
    <div className="flex flex-col rounded-control bg-inset inset-ring inset-ring-line-control">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex min-h-toolbar items-center gap-4 border-line px-3 py-1.5 not-first:border-t"
        >
          <span className="min-w-0 flex-1 text-fg text-ui">{row.label}</span>
          {row.control}
        </div>
      ))}
    </div>
  );
}

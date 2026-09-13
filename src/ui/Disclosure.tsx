import { type ReactNode, useId, useState } from "react";

import { GLYPHS } from "./glyphs";

type Props = {
  label: string;
  /** What the row says while it is closed, at its end: a size, a count. */
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
};

/** A row that opens to show more beneath it. It opens at once: it is clicked too often to perform. */
export function Disclosure({ label, summary, children, defaultOpen = false, onToggle }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
          onToggle?.(!open);
        }}
        className="focus-ring flex h-row items-center gap-2 rounded-control px-2 text-caption transition-colors duration-(--motion-quick) hover:bg-hover motion-reduce:transition-none"
      >
        <span
          aria-hidden="true"
          className="flex size-chevron shrink-0 items-center justify-center font-glyph text-fg-muted text-glyph"
        >
          {GLYPHS[open ? "chevronDown" : "chevronRight"]}
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-fg">{label}</span>
        {summary !== undefined && (
          <span className="shrink-0 font-numeric text-fg-muted tabular-nums">{summary}</span>
        )}
      </button>
      <div id={id} hidden={!open} className="px-2 pt-1 pb-2">
        {children}
      </div>
    </div>
  );
}

import { useState } from "react";

import { formatCount } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Glyph } from "../../ui/Glyph";
import { retryFailures, useWork } from "../navigation/work-store";

const COLUMNS = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_3.5rem] items-center gap-3.5 px-3";

/** What could not be read, above the grid until it is dealt with. DECISIONS.md "Background work". */
export function Notices() {
  const { failures } = useWork();
  const [open, setOpen] = useState(false);
  // Dismissal holds only for the failures counted then; a new one brings the banner back.
  const [dismissed, setDismissed] = useState(0);
  const count = failures.length;
  if (count === 0 || count === dismissed) return null;

  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="flex flex-col rounded-control bg-panel inset-ring inset-ring-line-danger">
        <div
          className={`flex min-h-toolbar items-center gap-2.5 py-1.5 pr-2 pl-3 ${open ? "border-line border-b" : ""}`}
        >
          <Glyph name="warning" className="shrink-0 text-danger text-icon" />
          <span className="min-w-0 flex-1 text-fg text-ui tabular-nums">
            {formatCount(count)} {count === 1 ? "file" : "files"} could not be indexed
          </span>
          <Button onClick={() => void retryFailures()}>Retry these</Button>
          <Button
            tone="quiet"
            expanded={open}
            detail={open && <Glyph name="chevronDown" className="rotate-180 text-glyph-small" />}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide the list" : `Show the ${formatCount(count)}`}
          </Button>
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setDismissed(count)}
            className="focus-ring grid size-control shrink-0 place-items-center rounded-control text-fg-dim text-glyph transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg motion-reduce:transition-none"
          >
            <Glyph name="close" />
          </button>
        </div>
        {open && (
          <div className="max-h-45 overflow-auto">
            <div className={`${COLUMNS} h-7 text-eyebrow text-fg-dim uppercase`}>
              <span>File</span>
              <span>What went wrong</span>
              <span className="text-right">Tries</span>
            </div>
            {failures.map((failure) => (
              <div
                key={failure.jobId}
                className={`${COLUMNS} h-control border-line border-t text-ui hover:bg-inset`}
              >
                <span className="truncate text-fg">{failure.name}</span>
                <span className="truncate text-fg-dim">{failure.error}</span>
                <span className="text-right text-fg-dim tabular-nums">{failure.attempts}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

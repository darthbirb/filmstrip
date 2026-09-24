import { useState } from "react";

import { formatCount } from "../../lib/format";
import { Banner, LIST_HEADING, LIST_ROW, listRow } from "../../ui/Banner";
import { retryFailures, useWork } from "../navigation/work-store";

const COLUMNS = listRow("badge");

/** What could not be read, above the grid until it is dealt with. DECISIONS.md "Background work". */
export function Notices() {
  const { failures } = useWork();
  const [open, setOpen] = useState(false);
  // Dismissal holds only for the failures counted then; a new one brings the banner back.
  const [dismissed, setDismissed] = useState(0);
  const count = failures.length;
  if (count === 0 || count === dismissed) return null;

  return (
    <Banner
      sentence={`${formatCount(count)} ${count === 1 ? "file" : "files"} could not be indexed`}
      retry={() => void retryFailures()}
      open={open}
      onToggle={() => setOpen(!open)}
      onDismiss={() => setDismissed(count)}
    >
      <div className={`${COLUMNS} ${LIST_HEADING}`}>
        <span>File</span>
        <span>Error</span>
        <span className="text-right">Attempts</span>
      </div>
      {failures.map((failure) => (
        <div key={failure.jobId} className={`${COLUMNS} ${LIST_ROW}`}>
          <span className="truncate text-fg">{failure.name}</span>
          <span className="truncate text-fg-dim">{failure.error}</span>
          <span className="text-right text-fg-dim tabular-nums">{failure.attempts}</span>
        </div>
      ))}
    </Banner>
  );
}

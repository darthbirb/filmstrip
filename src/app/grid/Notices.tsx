import { useState } from "react";

import type { Failure } from "../../ipc/bindings/Failure";
import { revealFolder, revealItem } from "../../ipc/commands";
import { formatCount } from "../../lib/format";
import { Banner, LIST_HEADING, LIST_ROW, listRow } from "../../ui/Banner";
import { failed } from "../failure";
import { retryFailures, useWork } from "../navigation/work-store";
import { reasonText, shownFailed } from "../undo/lines";
import { ShowInExplorer } from "../undo/ReportBanner";

const COLUMNS = listRow("figureControl");

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
        <span>Reason</span>
        <span className="text-right">Attempts</span>
        <span />
      </div>
      {failures.map((failure) => (
        <div key={failure.jobId} className={`${COLUMNS} ${LIST_ROW}`}>
          <span className="truncate text-fg">{placeOf(failure)}</span>
          <span className="truncate text-fg-dim">{reasonText(failure.reason)}</span>
          <span className="text-right text-fg-dim tabular-nums">{failure.attempts}</span>
          <Look failure={failure} />
        </div>
      ))}
    </Banner>
  );
}

/** Where a failure's file is inside its source, as Explorer writes a path. */
function placeOf(failure: Failure) {
  return failure.path.length > 0 ? failure.path.join("\\") : "The library";
}

/** Show in Explorer, for a row that names the file or folder it would show. */
function Look({ failure }: { failure: Failure }) {
  const { itemId, folderId } = failure;
  const name = failure.path.at(-1);
  const reveal =
    itemId !== null
      ? () => revealItem(itemId)
      : folderId !== null
        ? () => revealFolder(folderId)
        : null;
  if (!reveal || !name) return <span />;
  return (
    <ShowInExplorer name={name} onClick={() => void reveal().catch(failed(shownFailed(name)))} />
  );
}

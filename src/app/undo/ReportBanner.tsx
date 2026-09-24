import { Fragment, useState } from "react";

import type { Stayed } from "../../ipc/bindings/Stayed";
import { revealFolder, revealHeld, revealItem } from "../../ipc/commands";
import { Banner, LIST_HEADING, LIST_ROW, listRow } from "../../ui/Banner";
import { Glyph } from "../../ui/Glyph";
import { reasonText, stayedGroups } from "./lines";
import { type Report, showReport, useReport } from "./report-store";

const COLUMNS = listRow("control");

/** What an act or an undo could not finish, open, until it is dismissed. DECISIONS.md "Undo". */
export function ReportBanner() {
  const shown = useReport();
  // A new report opens afresh, whatever the last one was left as.
  return shown ? <Shown key={shown.id} report={shown.report} /> : null;
}

function Shown({ report }: { report: Report }) {
  const [open, setOpen] = useState(true);
  const groups = report.heading
    ? [{ heading: report.heading, rows: report.rows }]
    : stayedGroups(report.rows);
  return (
    <Banner
      sentence={report.sentence}
      retry={report.retry}
      open={open}
      onToggle={() => setOpen(!open)}
      onDismiss={() => showReport(null)}
    >
      {groups.map((group, index) => (
        <Fragment key={group.heading}>
          <div className={`${COLUMNS} ${LIST_HEADING} ${index > 0 ? "border-line border-t" : ""}`}>
            <span className="truncate">{group.heading}</span>
            {/* Said once, over the first group. */}
            <span>{index === 0 ? "Reason" : ""}</span>
            <span />
          </div>
          {group.rows.map((row) => (
            <Row key={`${row.kind}-${row.id}`} row={row} />
          ))}
        </Fragment>
      ))}
    </Banner>
  );
}

/** A file, or a folder in its parent; a folder a file kept, open, with that file selected. */
function reveal(row: Stayed) {
  if (row.kind === "file") return revealItem(row.id);
  return row.reason.kind === "holds" ? revealHeld(row.id) : revealFolder(row.id);
}

function Row({ row }: { row: Stayed }) {
  // Explorer has nothing to show for a file gone from disk, or one under the trash's own name.
  const showable = row.at.kind === "folder" && row.reason.kind !== "notOnDisk";
  return (
    <div className={`${COLUMNS} ${LIST_ROW}`}>
      <span className="flex min-w-0 items-center gap-2 text-fg">
        {row.kind === "folder" && (
          <Glyph name="folder" className="shrink-0 text-fg-dim text-glyph" />
        )}
        <span className="truncate">{row.name}</span>
      </span>
      <span className="truncate text-fg-dim">{reasonText(row.reason)}</span>
      {showable ? (
        <button
          type="button"
          aria-label={`Show ${row.name} in Explorer`}
          title="Show in Explorer"
          onClick={() => void reveal(row).catch(() => undefined)}
          className="focus-ring grid size-control place-items-center justify-self-end rounded-control text-fg-dim text-glyph transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg motion-reduce:transition-none"
        >
          <Glyph name="folderOpen" />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

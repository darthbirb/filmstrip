import { formatBytes, formatCount } from "../../lib/format";
import { Glyph } from "../../ui/Glyph";
import { useIndex } from "../navigation/index-store";

// What the library has in the Recycle Bin, and where a deleted file goes. Artboards › The Trash in
// the Recycle Bin; DECISIONS.md "The Trash is the Recycle Bin".

export function Trash() {
  const held = useIndex().totals?.trash;
  const said = !held
    ? ""
    : held.count === 0
      ? "Nothing in it"
      : `${formatCount(held.count)} ${held.count === 1 ? "file" : "files"} · ${formatBytes(held.bytes)}`;
  return (
    <div className="flex flex-col gap-2.5">
      <header className="flex shrink-0 items-center gap-2">
        <h3 className="m-0 font-semibold text-fg-hi text-row">Trash</h3>
        <span title={said} className="min-w-0 flex-1 truncate text-fg-dim text-small tabular-nums">
          {said}
        </span>
      </header>
      <p className="m-0 flex items-start gap-2 px-1 text-fg-dim text-small">
        <Glyph name="recycle" className="shrink-0 text-glyph" />
        <span className="min-w-0 flex-1 text-pretty">
          Deleted files go to the Windows Recycle Bin, on their own drive. Restore brings them back
          from the Trash.
        </span>
      </p>
    </div>
  );
}

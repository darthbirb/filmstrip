import type { MouseEvent } from "react";

import { Glyph } from "./Glyph";

type Props = {
  /** The folder's name, or what choosing one will do when there is none. */
  label: string;
  /** Quieter words after the name: the folder it is in, or where it was. */
  detail?: string;
  /** Nothing chosen yet: no ground, and the words quiet until the pointer comes. */
  empty?: boolean;
  /** What it names has gone: in the red. */
  broken?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

/**
 * A folder as a button that picks another, as a destination key's row names its folder. It reads
 * as the folder, a caret after it saying it opens a choice. DESIGN.md "Components".
 */
export function PlaceButton({ label, detail, empty = false, broken = false, onClick }: Props) {
  const tone = empty
    ? "text-fg-dim inset-ring-line-control hover:bg-raised hover:text-fg"
    : broken
      ? "bg-raised text-danger inset-ring-line-danger hover:bg-raised-hi"
      : "bg-raised text-fg inset-ring-line-control hover:bg-raised-hi";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring flex h-bar-field min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-nested pr-1.5 pl-2 text-left text-ui inset-ring transition-colors duration-(--motion-quick) motion-reduce:transition-none ${tone}`}
    >
      {empty ? (
        <Glyph name="moveTo" className="text-glyph" />
      ) : (
        <Glyph
          name={broken ? "folderGone" : "folder"}
          filled
          className={`text-glyph ${broken ? "" : "text-fg-dim"}`}
        />
      )}
      <span className={empty ? "truncate" : "shrink truncate"}>{label}</span>
      {detail && <span className="min-w-0 flex-1 truncate text-fg-dim text-small">{detail}</span>}
      {!empty && <Glyph name="chevronDown" className="ml-auto text-fg-dim text-glyph-small" />}
    </button>
  );
}

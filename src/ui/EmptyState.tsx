import type { ReactNode } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  glyph: GlyphName;
  title: string;
  note?: string;
  /** The one thing worth doing here, where there is one. Most places have none. */
  children?: ReactNode;
};

/** What a surface says when it has nothing to show: a large quiet glyph, a line, and a note. */
export function EmptyState({ glyph, title, note, children }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Glyph name={glyph} className="text-fg-faint text-glyph-large" />
      <p className="m-0 font-semibold text-fg-mid text-ui">{title}</p>
      {note && <p className="m-0 max-w-(--spacing-note) text-fg-dim text-small">{note}</p>}
      {children && <div className="flex flex-wrap justify-center gap-1.5 pt-1.5">{children}</div>}
    </div>
  );
}

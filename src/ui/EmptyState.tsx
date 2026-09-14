import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = { glyph: GlyphName; title: string; note?: string };

/** What a surface says when it has nothing to show: a large quiet glyph, a line, and a note. */
export function EmptyState({ glyph, title, note }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Glyph name={glyph} className="text-fg-faint text-glyph-large" />
      <p className="m-0 font-semibold text-fg-mid text-ui">{title}</p>
      {note && <p className="m-0 text-fg-dim text-small">{note}</p>}
    </div>
  );
}

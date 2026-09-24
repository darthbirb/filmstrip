import type { ReactNode } from "react";

import { Glyph } from "./Glyph";
import { GlyphButton } from "./GlyphButton";
import type { GlyphName } from "./glyphs";

type Props = {
  glyph: GlyphName;
  /** One sentence: what the act did, or what came back. */
  sentence: string;
  /** The way back, under the sentence, when there is one. */
  action?: ReactNode;
  onDismiss: () => void;
};

/**
 * What just happened at your request, at the foot of the panel it was asked from: the Band's
 * slot and shape without its alarm. DESIGN.md "Components".
 */
export function Line({ glyph, sentence, action, onDismiss }: Props) {
  return (
    <div className="flex items-start gap-2 border-line border-t py-2 pr-1.5 pl-2.5">
      <Glyph name={glyph} className="shrink-0 pt-0.5 text-fg-dim text-glyph" />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <span className="text-pretty text-fg text-ui tabular-nums">{sentence}</span>
        {action}
      </span>
      <GlyphButton glyph="close" label="Dismiss" onClick={onDismiss} />
    </div>
  );
}

import { Glyph } from "./Glyph";
import { GlyphButton } from "./GlyphButton";

type Props = {
  /** One line, said where the act began. */
  sentence: string;
  /** The folder it is about, in the mono a source's row uses. */
  path: string;
  onDismiss: () => void;
};

/** What could not be done, at the foot of the panel it was asked from. DESIGN.md "Shapes". */
export function Band({ sentence, path, onDismiss }: Props) {
  return (
    <div className="flex items-start gap-2 border-line border-t bg-danger-wash py-2 pr-1.5 pl-2.5">
      <Glyph name="warning" className="shrink-0 pt-0.5 text-danger text-glyph" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-fg text-small">{sentence}</span>
        <span className="truncate font-mono text-eyebrow text-fg-dim" title={path}>
          {path}
        </span>
      </span>
      <GlyphButton glyph="close" label="Dismiss" onClick={onDismiss} />
    </div>
  );
}

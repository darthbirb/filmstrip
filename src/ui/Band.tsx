import type { ReactNode } from "react";

import { DismissButton } from "./DismissButton";
import { Glyph } from "./Glyph";

type Props = {
  /** One line, said where the act began. */
  sentence: string;
  /** The folder it is about, in the mono a source's row uses. */
  path?: string;
  /** Why, in words, under the sentence. */
  detail?: string;
  /** The way to what it is about, under the sentence, when there is one. */
  action?: ReactNode;
  onDismiss: () => void;
};

/** What could not be done, at the foot of the panel it was asked from. DESIGN.md "Shapes". */
export function Band({ sentence, path, detail, action, onDismiss }: Props) {
  return (
    <div className="flex items-start gap-2 border-line border-t bg-danger-wash py-2 pr-1.5 pl-2.5">
      <Glyph name="warning" className="shrink-0 pt-0.5 text-danger text-glyph" />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <span className="flex max-w-full flex-col gap-0.5">
          <span className="text-fg text-small">{sentence}</span>
          {detail && <span className="text-fg-dim text-small">{detail}</span>}
          {path && (
            <span className="truncate font-mono text-eyebrow text-fg-dim" title={path}>
              {path}
            </span>
          )}
        </span>
        {action}
      </span>
      <DismissButton label="Dismiss" onClick={onDismiss} />
    </div>
  );
}

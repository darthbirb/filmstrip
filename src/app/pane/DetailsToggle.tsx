import type { ReactNode } from "react";

import { Glyph } from "../../ui/Glyph";
import { updatePreferences, usePreferences } from "../preferences";

/** The details' section, whichever the pane shows; one at a time, so one id. */
export const DETAILS_ID = "pane-details";

/**
 * The pane header's row: the way into full screen, then what is shown summed up, as the disclosure
 * that opens onto its details. The open state is the saved preference.
 */
export function DetailsToggle({ into, children }: { into: ReactNode; children: ReactNode }) {
  const open = usePreferences().details ?? false;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {into}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={DETAILS_ID}
        onClick={() => updatePreferences({ details: !open })}
        className="focus-ring flex h-control w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-fg-mid text-ui tabular-nums transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg aria-expanded:bg-raised aria-expanded:text-fg motion-reduce:transition-none"
      >
        <Glyph
          name="chevronRight"
          className={`text-fg-dim text-icon transition-transform duration-(--motion-quick) ease-out motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
        {children}
      </button>
    </div>
  );
}

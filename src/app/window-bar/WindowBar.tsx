import { getCurrentWindow } from "@tauri-apps/api/window";

import mark from "../../assets/mark.svg";
import { CaptionButton } from "../../ui/CaptionButton";
import { useWindowState } from "./useWindowState";

/** Windows' own caption strip: the bar belongs to the window. DECISIONS.md "The window". */
export function WindowBar() {
  const { maximized, focused } = useWindowState();
  const win = getCurrentWindow();
  const dimmed = !focused;

  return (
    <header
      data-tauri-drag-region
      className="flex h-caption shrink-0 select-none items-center justify-between"
    >
      {/* Ignores the pointer, so the bar beneath it still drags. */}
      <span
        className={`pointer-events-none flex items-center gap-3 px-3 text-caption ${dimmed ? "text-fg-muted" : ""}`}
      >
        <img src={mark} alt="" className="size-mark" />
        Filmstrip
      </span>
      <div className="flex h-full">
        <CaptionButton
          glyph="minimize"
          label="Minimise"
          dimmed={dimmed}
          onClick={() => void win.minimize()}
        />
        <CaptionButton
          glyph={maximized ? "restore" : "maximize"}
          label={maximized ? "Restore" : "Maximise"}
          dimmed={dimmed}
          onClick={() => void win.toggleMaximize()}
        />
        <CaptionButton
          glyph="close"
          label="Close"
          dimmed={dimmed}
          onClick={() => void win.close()}
        />
      </div>
    </header>
  );
}

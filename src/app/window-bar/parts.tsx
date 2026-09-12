import { getCurrentWindow } from "@tauri-apps/api/window";

import mark from "../../assets/mark.svg";
import { CaptionButton } from "../../ui/CaptionButton";

/** The mark and the name. It ignores the pointer, so the bar beneath it still drags. */
export function Identity({ dimmed }: { dimmed: boolean }) {
  return (
    <span
      className={`pointer-events-none flex items-center gap-3 px-3 text-caption ${dimmed ? "text-fg-muted" : ""}`}
    >
      <img src={mark} alt="" className="size-mark" />
      Filmstrip
    </span>
  );
}

/** Minimise, maximise or restore, and close, full height against the window edge. */
export function CaptionButtons({ maximized, dimmed }: { maximized: boolean; dimmed: boolean }) {
  const win = getCurrentWindow();
  return (
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
      <CaptionButton glyph="close" label="Close" dimmed={dimmed} onClick={() => void win.close()} />
    </div>
  );
}

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";

import mark from "../../assets/mark.svg";
import { CaptionButton } from "../../ui/CaptionButton";
import { useWindowState } from "./useWindowState";

/** The caption strip, with search centred on the window. DECISIONS.md "The window". */
export function WindowBar({ search }: { search?: ReactNode }) {
  const { maximized, focused } = useWindowState();
  const win = getCurrentWindow();
  const dimmed = !focused;

  return (
    <header
      data-tauri-drag-region
      className="grid h-caption shrink-0 select-none grid-cols-[1fr_minmax(0,var(--spacing-bar-search))_1fr] items-center bg-panel"
    >
      {/* Ignores the pointer, so the bar beneath it still drags. */}
      <span
        className={`pointer-events-none flex items-center gap-2.25 justify-self-start pr-3 pl-2.5 font-brand text-wordmark ${dimmed ? "text-fg-dim" : "text-fg"}`}
      >
        <img src={mark} alt="" className="size-mark" />
        Filmstrip
      </span>
      <div className="flex h-bar-field min-w-0 px-2">{search}</div>
      <div className="flex h-full justify-self-end">
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

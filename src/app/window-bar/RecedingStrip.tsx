import { CaptionButtons, Identity } from "./parts";
import { useWindowState } from "./useWindowState";

/** The strip laid over the content, stepping aside once the pointer leaves the top of the window. */
export function RecedingStrip() {
  const { maximized, focused } = useWindowState();
  return (
    <header
      data-tauri-drag-region
      className="absolute inset-x-0 top-0 z-10 flex h-caption select-none items-center justify-between bg-scrim opacity-0 transition-opacity delay-(--motion-linger) duration-(--motion-quick) focus-within:opacity-100 focus-within:delay-0 hover:opacity-100 hover:delay-0 motion-reduce:transition-none"
    >
      <Identity dimmed={!focused} />
      <CaptionButtons maximized={maximized} dimmed={!focused} />
    </header>
  );
}

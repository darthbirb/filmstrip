import { CaptionButtons, Identity } from "./parts";
import { useWindowState } from "./useWindowState";

/** Windows' own caption height. The bar belongs to the window; the app's toolbars sit below it. */
export function CaptionStrip() {
  const { maximized, focused } = useWindowState();
  return (
    <header
      data-tauri-drag-region
      className="flex h-caption shrink-0 select-none items-center justify-between"
    >
      <Identity dimmed={!focused} />
      <CaptionButtons maximized={maximized} dimmed={!focused} />
    </header>
  );
}

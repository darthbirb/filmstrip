import { CaptionButtons, Identity } from "./parts";
import { useWindowState } from "./useWindowState";

/** Windows 11's tall title bar. The bar is the app's header: location and search would live here. */
export function TallHeader() {
  const { maximized, focused } = useWindowState();
  return (
    <header
      data-tauri-drag-region
      className="flex h-header shrink-0 select-none items-center justify-between"
    >
      <Identity dimmed={!focused} />
      <CaptionButtons maximized={maximized} dimmed={!focused} />
    </header>
  );
}

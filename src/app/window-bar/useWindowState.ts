import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

/** Whether the window is maximised and focused, kept current from Tauri's own events. */
export function useWindowState() {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    const win = getCurrentWindow();
    let live = true;
    const sync = () => {
      void win.isMaximized().then((value) => {
        if (live) setMaximized(Boolean(value));
      });
    };
    sync();
    const unlisteners = [
      win.onResized(sync),
      win.onFocusChanged(({ payload }) => {
        if (live) setFocused(payload);
      }),
    ];
    return () => {
      live = false;
      for (const unlisten of unlisteners) void unlisten.then((stop) => stop());
    };
  }, []);

  return { maximized, focused };
}

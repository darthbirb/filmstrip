// A field keeps the platform's menu, because cut, copy, paste and the spell-checker live there
// and the app does not reimplement them. DECISIONS.md "The window".
const FIELD = "input, textarea, [contenteditable]:not([contenteditable='false'])";

/** Turns off the browser's own right-click menu everywhere but in a field; returns the undo. */
export function suppressBrowserMenu(target: Document = document) {
  const onContextMenu = (event: Event) => {
    if ((event.target as Element | null)?.closest?.(FIELD)) return;
    event.preventDefault();
  };
  target.addEventListener("contextmenu", onContextMenu);
  return () => target.removeEventListener("contextmenu", onContextMenu);
}

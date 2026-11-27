import { autoPopoverOpen } from "../ui/Menu";

const OWNS_KEYS =
  "input, textarea, select, [contenteditable], [role=menu], [popover], [data-question]";

type Options = {
  /** Leaves Ctrl, Alt, Shift and the Windows key for the caller to judge. */
  modifiers?: boolean;
};

/**
 * Whether a key is the app's: nothing took it first, no modifier is held, and no field, menu,
 * popover, question or dialog has it.
 */
export function keyIsFree(event: KeyboardEvent, { modifiers = false }: Options = {}) {
  if (event.defaultPrevented) return false;
  if (!modifiers && (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)) {
    return false;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(OWNS_KEYS)) return false;
  return !autoPopoverOpen() && document.querySelector("dialog[open]") === null;
}

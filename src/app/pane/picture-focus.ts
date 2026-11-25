// The pane's one picture, once drawn, and a focus asked of a picture not drawn yet. Only the next
// picture drawn may answer a request, so one that never arrives is not answered by a later one.
let drawn: { id: number; area: HTMLElement } | null = null;
let wanted: number | "next" | null = null;

/** The next picture the pane draws takes the focus, so a set shown down to one keeps it in the pane. */
export function focusNextPicture() {
  wanted = "next";
}

/** This item's picture takes the focus: now if the pane has drawn it within reach, else once it is. */
export function focusPicture(id: number) {
  if (drawn?.id === id && reachable(drawn.area)) {
    wanted = null;
    drawn.area.focus();
  } else {
    wanted = id;
  }
}

/** The pane's picture is drawn in this area; returns what to call when it goes. */
export function holdPicture(id: number, area: HTMLElement) {
  const own = { id, area };
  drawn = own;
  if (wanted !== "next" && wanted !== id) {
    wanted = null;
  } else if (reachable(area)) {
    wanted = null;
    area.focus();
  } else {
    wanted = id;
  }
  return () => {
    if (drawn === own) drawn = null;
  };
}

/**
 * The pane's picture may have come within reach: a folded pane is inert until the render that
 * unfolds it, so a request made before that render is answered after it.
 */
export function reachPicture(id: number, area: HTMLElement) {
  if (wanted !== id || !reachable(area)) return;
  wanted = null;
  area.focus();
}

function reachable(area: HTMLElement) {
  return !area.closest("[inert]");
}

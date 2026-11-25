// The pane's one picture, once drawn, and a focus asked of a picture not drawn yet. Only the next
// picture drawn may answer a request, so one that never arrives is not answered by a later one.
let drawn: { id: number; area: HTMLElement } | null = null;
let wanted: number | "next" | null = null;
let waiting: (() => void) | null = null;

/** The next picture the pane draws takes the focus, so a set shown down to one keeps it in the pane. */
export function focusNextPicture() {
  stopWaiting();
  wanted = "next";
}

/** This item's picture takes the focus: now if the pane has drawn it within reach, else once it is. */
export function focusPicture(id: number) {
  stopWaiting();
  wanted = id;
  if (drawn?.id === id) answer(id, drawn.area);
}

/** Whatever focus was asked of a picture is no longer wanted. */
export function forgetPictureFocus() {
  stopWaiting();
  wanted = null;
}

/** The pane's picture is drawn in this area; returns what to call when it goes. */
export function holdPicture(id: number, area: HTMLElement) {
  const own = { id, area };
  drawn = own;
  if (wanted === "next" || wanted === id) {
    answer(id, area);
  } else {
    stopWaiting();
    wanted = null;
  }
  return () => {
    if (drawn === own) drawn = null;
  };
}

/** The pane's picture may have come within reach, as entering full screen unfolds a folded pane. */
export function reachPicture(id: number, area: HTMLElement) {
  if (wanted === id) answer(id, area);
}

/**
 * Focuses the picture, or keeps the request until it can. A folded pane's face is inert until the
 * render that unfolds it, and hidden for the first frame of its fade in, so its fade's end asks again.
 */
function answer(id: number, area: HTMLElement) {
  stopWaiting();
  wanted = id;
  if (!area.closest("[inert]") && area.checkVisibility({ visibilityProperty: true })) {
    area.focus();
    if (document.activeElement === area) {
      wanted = null;
      return;
    }
  }
  const again = (event: TransitionEvent) => {
    if (wanted === id && event.target instanceof Node && event.target.contains(area)) {
      answer(id, area);
    }
  };
  document.addEventListener("transitionend", again);
  waiting = () => document.removeEventListener("transitionend", again);
}

function stopWaiting() {
  waiting?.();
  waiting = null;
}

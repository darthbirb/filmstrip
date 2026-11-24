// The pane's one picture, once drawn, and a focus asked of a picture not drawn yet. Only the next
// picture drawn may answer a request, so one that never arrives is not answered by a later one.
let drawn: { id: number; area: HTMLElement } | null = null;
let wanted: number | "next" | null = null;

/** The next picture the pane draws takes the focus, so a set shown down to one keeps it in the pane. */
export function focusNextPicture() {
  wanted = "next";
}

/** This item's picture takes the focus: now if the pane has drawn it, else once it does. */
export function focusPicture(id: number) {
  if (drawn?.id === id) {
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
  const take = wanted === "next" || wanted === id;
  wanted = null;
  if (take) area.focus();
  return () => {
    if (drawn === own) drawn = null;
  };
}

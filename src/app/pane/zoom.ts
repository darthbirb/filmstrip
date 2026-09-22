// The geometry of zooming the pane's picture, kept apart from the pane so it can be checked on its
// own. Behaviour ported from ggallery; what is held is Filmstrip's. DECISIONS.md "The pane".

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/**
 * A zoomed picture: a multiple of the scale it fits at, and the image point, in its own pixels, at
 * the centre of the area. Null is fit. Neither is a screen size, so a re-fit keeps the same view.
 */
export type View = { multiple: number; centre: Point } | null;

/** One wheel notch in and out; the out notch is not the in notch's inverse, as in ggallery. */
export const NOTCH_IN = 1.12;
export const NOTCH_OUT = 0.89;
/** The absolute scale, against the picture's own pixels, is held between these, and never above fit. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 12;

/** The scale the picture is drawn at when it fits: shrunk to the area, never stretched past its own size. */
export function fitScale(area: Size, image: Size) {
  if (!(area.width && area.height && image.width && image.height)) return 1;
  return Math.min(1, area.width / image.width, area.height / image.height);
}

export function scaleOf(view: View, fit: number) {
  return view ? view.multiple * fit : fit;
}

function centreOf(view: View, image: Size): Point {
  return view ? view.centre : { x: image.width / 2, y: image.height / 2 };
}

/**
 * Zooms by `factor` about `at`, an offset from the area's centre, keeping whatever image point is
 * under it exactly where it is. From fit it starts at the fitted scale, so the first notch never jumps.
 */
export function zoomAbout(view: View, factor: number, at: Point, fit: number, image: Size): View {
  const scale = scaleOf(view, fit);
  const centre = centreOf(view, image);
  // A large picture in a small pane fits below the floor, and the first notch must not jump to it.
  const floor = Math.min(MIN_SCALE, fit);
  const next = Math.min(MAX_SCALE, Math.max(floor, scale * factor));
  const under = { x: centre.x + at.x / scale, y: centre.y + at.y / scale };
  return {
    multiple: next / fit,
    centre: { x: under.x - at.x / next, y: under.y - at.y / next },
  };
}

/** Moves the picture by a distance on screen. A picture at fit has nowhere to go. */
export function panBy(view: View, delta: Point, fit: number): View {
  if (!view) return view;
  const scale = view.multiple * fit;
  return {
    ...view,
    centre: { x: view.centre.x - delta.x / scale, y: view.centre.y - delta.y / scale },
  };
}

/** Whether the picture runs past the area in either direction, which is all a drag can move. */
export function pannable(view: View, fit: number, image: Size, area: Size) {
  if (!view) return false;
  const scale = view.multiple * fit;
  // Half a pixel, so a picture that exactly fills one side does not claim room it lacks.
  return image.width * scale > area.width + 0.5 || image.height * scale > area.height + 0.5;
}

/** Where the picture's top-left corner sits in the area, and how big it is drawn. */
export function placement(view: View, fit: number, image: Size, area: Size) {
  const scale = scaleOf(view, fit);
  const centre = centreOf(view, image);
  return {
    left: area.width / 2 - centre.x * scale,
    top: area.height / 2 - centre.y * scale,
    width: image.width * scale,
    height: image.height * scale,
  };
}

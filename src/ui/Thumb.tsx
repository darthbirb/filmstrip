import { Glyph } from "./Glyph";

/** The classes a thumbnail's own element needs: its corner, and the hatch until a picture covers it. */
export const THUMB_FRAME = "group @container relative overflow-hidden rounded-control hatch";

type FaceProps = {
  src?: string;
  /** The pane is showing it. */
  current?: boolean;
  /** Whether the in-pane plate is drawn; a filmstrip frame carries the ring alone. */
  badge?: boolean;
  /** A video's length, written in the corner. */
  duration?: string;
};

/** What a thumbnail draws inside its own button: the picture, a ring under the pointer, and its marks. */
export function ThumbFace({ src, current = false, badge = true, duration }: FaceProps) {
  return (
    <>
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          className="size-full object-cover"
        />
      )}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-control ${current ? "inset-ring-2 inset-ring-in-pane" : "group-hover:inset-ring group-hover:inset-ring-line-strong"}`}
      />
      {current && badge && (
        <span className="pointer-events-none absolute bottom-tile-inset left-tile-inset flex h-badge items-center gap-1 whitespace-nowrap rounded-badge bg-in-pane px-1.5 text-eyebrow text-on-mark uppercase @max-badge:w-badge @max-badge:justify-center @max-badge:px-0">
          <Glyph name="view" filled className="text-glyph-small" />
          <span className="@max-badge:hidden">In pane</span>
        </span>
      )}
      {duration && (
        <span className="pointer-events-none absolute right-tile-inset bottom-tile-inset flex h-badge items-center rounded-badge bg-veil px-1.5 text-fg text-small tabular-nums">
          {duration}
        </span>
      )}
    </>
  );
}

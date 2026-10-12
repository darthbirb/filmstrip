import { Glyph } from "./Glyph";
import { Plate } from "./Plate";

/** The classes a thumbnail's own element needs: its corner, and the hatch until a picture covers it. */
export const THUMB_FRAME = "group @container relative overflow-hidden rounded-control hatch";

/** A video under the pointer: how far across it is, and what it shows there. */
export type Scrubbing = {
  /** From 0 at the left edge to 1 at the right. */
  at: number;
  /** The time in the clip under the pointer. */
  time: string;
  /** The strip of frames and the cell to show; none for a video that has no scrub frames. */
  frames?: { src: string; count: number; cell: number };
};

type FaceProps = {
  src?: string;
  /** The pane is showing it. */
  current?: boolean;
  /** Whether the in-pane plate is drawn; a filmstrip frame carries the ring alone. */
  badge?: boolean;
  /** A video's length, written in the corner. */
  duration?: string;
  scrub?: Scrubbing;
};

/** What a thumbnail draws inside its own button: the picture, a ring under the pointer, and its marks. */
export function ThumbFace({ src, current = false, badge = true, duration, scrub }: FaceProps) {
  const frames = scrub?.frames;
  const position = scrub ? `${scrub.at * 100}%` : undefined;
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
      {frames && (
        <img
          data-scrub-frames
          src={frames.src}
          alt=""
          draggable={false}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          style={{ objectViewBox: cellOf(frames.cell, frames.count) }}
        />
      )}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-control ${current ? "inset-ring-2 inset-ring-in-pane" : "group-hover:inset-ring group-hover:inset-ring-line-strong"}`}
      />
      {current && badge && (
        <span className="pointer-events-none absolute bottom-tile-inset left-tile-inset flex h-badge items-center gap-1 whitespace-nowrap rounded-badge bg-in-pane px-1.5 text-eyebrow text-on-mark uppercase @max-badge:w-badge @max-badge:justify-center @max-badge:px-0">
          <Glyph name="view" filled className="text-glyph-small" />
          <span className="@max-badge:hidden">In Pane</span>
        </span>
      )}
      {scrub && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-progress ${frames ? "bg-track" : "track-dashed"}`}
        >
          {frames && <span className="block h-full bg-in-pane" style={{ width: position }} />}
        </span>
      )}
      {frames && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 h-2 w-0.5 -translate-x-1/2 bg-in-pane"
          style={{ left: position }}
        />
      )}
      {scrub && !frames && !(current && badge) && (
        <Plate
          look="note"
          className="pointer-events-none absolute bottom-tile-inset left-tile-inset @max-note:hidden"
        >
          No Preview
        </Plate>
      )}
      {duration && (
        <Plate className="pointer-events-none absolute right-tile-inset bottom-tile-inset">
          {frames && scrub ? (
            scrub.time
          ) : (
            <>
              <Glyph name="play" filled className="text-glyph-small" />
              {duration}
            </>
          )}
        </Plate>
      )}
    </>
  );
}

/** One cell of a strip laid side by side, as the part of the image the picture is cropped from. */
function cellOf(cell: number, count: number) {
  const step = 100 / count;
  return `inset(0% ${(count - 1 - cell) * step}% 0% ${cell * step}%)`;
}

import { Glyph } from "./Glyph";

/** The classes a thumbnail's own element needs: its corner, and the hatch until a picture covers it. */
export const THUMB_FRAME = "group @container relative overflow-hidden rounded-control hatch";

type FaceProps = {
  src?: string;
  /** The pane is showing it. */
  current?: boolean;
  /** Whether "In pane" is spelt out; a frame too small for words shows the ring alone. */
  badge?: boolean;
};

/** What a thumbnail draws inside its own button: the picture, a ring under the pointer, and the in-pane mark. */
export function ThumbFace({ src, current = false, badge = true }: FaceProps) {
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
        className={`pointer-events-none absolute inset-0 rounded-control ${current ? "inset-ring-2 inset-ring-focus" : "group-hover:inset-ring group-hover:inset-ring-line-strong"}`}
      />
      {current && badge && (
        <span className="pointer-events-none absolute bottom-tile-inset left-tile-inset flex h-badge items-center gap-1 whitespace-nowrap rounded-badge bg-badge px-1.5 text-eyebrow text-on-plate uppercase">
          <Glyph name="view" className="text-glyph-small" />
          <span className="@max-badge:hidden">In pane</span>
        </span>
      )}
    </>
  );
}

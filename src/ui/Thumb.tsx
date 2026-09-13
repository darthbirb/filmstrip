/** What every thumbnail draws inside its own button or option: the picture, a veil under the pointer, the accent ring when current. */
export function ThumbFace({ src, current = false }: { src?: string; current?: boolean }) {
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
        className={`pointer-events-none absolute inset-0 rounded-tile group-hover:bg-hover ${current ? "shadow-[inset_0_0_0_var(--focus-width)_var(--color-accent)]" : ""}`}
      />
    </>
  );
}

/** The classes a thumbnail's own element needs, so the face inside it can draw. */
export const THUMB_FRAME = "group relative overflow-hidden rounded-tile bg-hover";

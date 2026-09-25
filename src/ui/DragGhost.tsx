import { Glyph } from "./Glyph";

type Props = {
  /** The pointer's tip, in the window's pixels. */
  x: number;
  y: number;
  /** The top file's picture, when it has one. */
  thumb?: string;
  /** More than one file rides under it, stacked behind the picture. */
  stacked: boolean;
  /** The row under it will not take the drop: the red prohibit, then why. */
  refused: boolean;
  /** The count, the act it will be, or the reason it will not. */
  label: string;
};

/**
 * What a drag carries, one line following the pointer: the top picture with the rest stacked
 * behind it, and words that say what letting go will do. DESIGN.md "Components".
 */
export function DragGhost({ x, y, thumb, stacked, refused, label }: Props) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-(--z-overlay) flex h-control items-center gap-2 whitespace-nowrap rounded-control bg-veil pr-2.5 pl-1 text-fg text-ui tabular-nums shadow-overlay inset-ring inset-ring-line-control-hi"
      style={{
        transform: `translate(calc(${x}px + var(--ghost-x)), calc(${y}px + var(--ghost-y)))`,
      }}
    >
      <span
        className={`hatch size-ghost-thumb shrink-0 rounded-badge ${stacked ? "shadow-[var(--ghost-stack)_calc(var(--ghost-stack)*-1)_0_0_var(--color-line-strong)]" : ""}`}
      >
        {thumb && (
          <img
            src={thumb}
            alt=""
            draggable={false}
            className="size-full rounded-badge object-cover"
          />
        )}
      </span>
      {refused && <Glyph name="prohibit" className="text-danger text-glyph" />}
      <span>{label}</span>
    </div>
  );
}

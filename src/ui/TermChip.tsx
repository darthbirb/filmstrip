import type { Shape } from "../ipc/bindings/Shape";
import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  /** A folder, a place, a tag or a label; text is never a chip. */
  shape: Exclude<Shape, { kind: "text" }>;
  /** The term as the query reads it, for the tooltip. */
  text: string;
  /** Takes the term out of the query; a chip without it is read-only. */
  onRemove?: () => void;
  /** Backspace's first press: the next removes it. */
  plated?: boolean;
};

const PLACES: Record<"sorting" | "trash", { glyph: GlyphName; title: string }> = {
  sorting: { glyph: "sortingBox", title: "Sorting Box" },
  trash: { glyph: "trash", title: "Trash" },
};

/**
 * A term the field understood, in the shape its kind has in the pane's details, at badge height:
 * a folder or a place square with its filled glyph, a tag a pill, a label its key sunk beside its
 * value. Components › "The field holds the query".
 */
export function TermChip({ shape, text, onRemove, plated = false }: Props) {
  const tone = plated ? "bg-plate text-on-plate" : "bg-raised text-fg";
  const remove = onRemove && (
    <button
      type="button"
      aria-label={`Remove ${text}`}
      title="Remove"
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRemove}
      className={`grid size-4 shrink-0 place-items-center rounded-mark-badge ${plated ? "text-on-plate-dim" : "text-fg-dim hover:bg-raised-hi hover:text-fg"}`}
    >
      <Glyph name="close" className="text-glyph-small" />
    </button>
  );
  if (shape.kind === "label") {
    return (
      <span
        title={text}
        className={`inline-flex h-badge shrink-0 overflow-hidden whitespace-nowrap rounded-badge text-small inset-ring ${plated ? "inset-ring-plate" : "inset-ring-line-control"}`}
      >
        <span className="flex items-center bg-panel px-1.5 text-fg-dim">{shape.key}</span>
        <span
          className={`flex items-center gap-0.5 pl-1.5 ${onRemove ? "pr-0.5" : "pr-1.5"} ${tone}`}
        >
          {shape.value}
          {remove}
        </span>
      </span>
    );
  }
  const pill = shape.kind === "tag";
  const ring = plated
    ? "inset-ring-plate"
    : pill
      ? "inset-ring-line-control-hi"
      : "inset-ring-line-control";
  const place = shape.kind === "place" ? PLACES[shape.place] : undefined;
  const glyph = shape.kind === "path" ? "folder" : place?.glyph;
  const label =
    shape.kind === "tag"
      ? shape.value
      : shape.kind === "path"
        ? (shape.titles.at(-1) ?? "")
        : (place?.title ?? "");
  return (
    <span
      title={shape.kind === "path" ? shape.titles.join(" / ") : text}
      className={`inline-flex h-badge shrink-0 items-center gap-1 whitespace-nowrap text-small inset-ring ${tone} ${ring} ${pill ? "rounded-full pl-2" : "rounded-badge pl-1.5"} ${onRemove ? "pr-0.5" : pill ? "pr-2" : "pr-1.5"}`}
    >
      {glyph && (
        <Glyph
          name={glyph}
          filled
          className={`text-glyph-small ${plated ? "text-on-plate-dim" : "text-fg-dim"}`}
        />
      )}
      {label}
      {remove}
    </span>
  );
}

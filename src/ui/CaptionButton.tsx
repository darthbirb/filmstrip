import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Props = {
  glyph: Extract<GlyphName, "minimize" | "maximize" | "restore" | "close" | "settings">;
  label: string;
  dimmed: boolean;
  onClick: () => void;
  /** For a button that opens a dialog: whether it is open. */
  expanded?: boolean;
};

/** A window control in Windows' own proportions; close turns red under the pointer. */
export function CaptionButton({ glyph, label, dimmed, onClick, expanded }: Props) {
  const tone =
    glyph === "close"
      ? "hover:bg-danger hover:text-on-danger active:bg-danger-press"
      : "hover:bg-raised-hi hover:text-fg active:bg-raised aria-expanded:bg-raised-hi aria-expanded:text-fg";
  // The squares sit smaller than the dash and the cross, so the three read as one weight.
  const size = glyph === "maximize" || glyph === "restore" ? "text-glyph-small" : "text-glyph";

  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      aria-expanded={expanded}
      title={label}
      onClick={onClick}
      className={`focus-ring-inset flex h-full w-caption-button shrink-0 items-center justify-center transition-colors duration-(--motion-quick) motion-reduce:transition-none ${dimmed ? "text-fg-faint" : "text-fg-mid"} ${tone}`}
    >
      <Glyph name={glyph} className={size} />
    </button>
  );
}

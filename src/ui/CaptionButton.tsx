import { GLYPHS, type Glyph } from "./glyphs";

type Props = {
  glyph: Extract<Glyph, "minimize" | "maximize" | "restore" | "close">;
  label: string;
  dimmed: boolean;
  onClick: () => void;
};

/** A window control in the glyphs and proportions Windows itself uses; close turns red under the pointer. */
export function CaptionButton({ glyph, label, dimmed, onClick }: Props) {
  const tone =
    glyph === "close"
      ? "hover:bg-danger hover:text-on-danger active:bg-danger-press"
      : "hover:bg-hover hover:text-fg active:bg-press";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`focus-ring flex h-full w-caption-button shrink-0 items-center justify-center font-glyph text-glyph transition-colors duration-(--motion-quick) motion-reduce:transition-none ${dimmed ? "text-fg-muted" : "text-fg"} ${tone}`}
    >
      <span aria-hidden="true">{GLYPHS[glyph]}</span>
    </button>
  );
}

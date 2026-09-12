const GLYPHS = {
  minimize: "\uE921",
  maximize: "\uE922",
  restore: "\uE923",
  close: "\uE8BB",
} as const;

type Props = {
  glyph: keyof typeof GLYPHS;
  label: string;
  dimmed: boolean;
  onClick: () => void;
};

/** A window control in Windows' own glyphs and proportions; close turns red under the pointer. */
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

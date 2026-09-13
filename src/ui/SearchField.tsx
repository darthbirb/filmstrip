import { GLYPHS } from "./glyphs";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

/** A text field that leads with the search glyph; its label is spoken, not shown. DESIGN.md "Components". */
export function SearchField({ label, value, onChange, placeholder }: Props) {
  return (
    <label className="flex h-bar-field min-w-0 flex-1 items-center gap-2 rounded-control bg-hover px-2 text-caption focus-within:bg-selected">
      <span aria-hidden="true" className="font-glyph text-fg-muted text-glyph">
        {GLYPHS.search}
      </span>
      <input
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted"
      />
    </label>
  );
}

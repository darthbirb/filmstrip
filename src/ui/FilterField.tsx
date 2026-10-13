import { Glyph } from "./Glyph";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** What it shows of the whole, once something is typed: "3 of 228". */
  count?: string;
};

/**
 * A field that narrows the list under it as you type: `bar-field` tall on `ground` at the `nested`
 * corner, the search glyph before it and the count at its end. DESIGN.md "Components".
 */
export function FilterField({ label, value, onChange, count }: Props) {
  return (
    <div className="relative flex shrink-0">
      <label className="flex min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <Glyph
          name="search"
          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-dim text-glyph"
        />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || value === "") return;
            event.preventDefault();
            onChange("");
          }}
          placeholder={label}
          className="focus-ring h-bar-field w-full min-w-0 rounded-nested bg-ground pr-16 pl-7 text-fg text-ui inset-ring inset-ring-line-control placeholder:text-fg-dim focus:inset-ring-line-strong [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      {count && (
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-dim text-small tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

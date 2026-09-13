type Option<T extends string> = { value: T; label: string; title?: string };

type Props<T extends string> = {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** A few exclusive choices side by side, the chosen one raised. DESIGN.md "Components". */
export function Segmented<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <fieldset
      aria-label={label}
      className="flex h-control min-w-0 shrink-0 items-center gap-px rounded-control bg-hover p-px"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className="focus-ring flex h-full items-center rounded-control px-3 text-caption text-fg-muted transition-colors duration-(--motion-quick) hover:text-fg aria-pressed:bg-raised aria-pressed:text-fg motion-reduce:transition-none"
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

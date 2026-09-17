import { useId } from "react";

type Choice<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  options: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** A value with few enough answers to show them all, the one it is on filled. DESIGN.md "Shapes". */
export function Segmented<T extends string>({ label, options, value, onChange }: Props<T>) {
  // Real radios, so the arrow keys move between them without the component saying how.
  const group = useId();
  return (
    <fieldset className="flex h-control shrink-0 items-center gap-0.5 rounded-control border-0 bg-inset p-0.5 inset-ring inset-ring-line-control">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex h-full cursor-default items-center rounded-nested px-2 text-ui transition-colors duration-(--motion-quick) has-focus-visible:outline has-focus-visible:outline-focus motion-reduce:transition-none ${
            option.value === value
              ? "bg-raised-hi text-fg-hi"
              : "text-fg-mid hover:bg-wash hover:text-fg"
          }`}
        >
          <input
            type="radio"
            name={group}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

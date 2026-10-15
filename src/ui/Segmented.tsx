import { useId } from "react";

type Choice<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  options: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  /** A chip high, for a row of the details; a control high everywhere else. */
  size?: "control" | "chip";
  /** Across the whole width, the answers sharing it, as in a sheet. */
  fill?: boolean;
};

const SIZES = {
  control: {
    group: "h-control gap-0.5 rounded-control p-0.5",
    option: "rounded-nested text-ui",
    idle: "text-fg-mid hover:bg-wash hover:text-fg",
    chosen: "bg-raised-hi text-fg-hi",
  },
  chip: {
    group: "h-chip gap-0.75 rounded-nested p-0.75",
    option: "rounded-badge text-small",
    idle: "text-fg-dim hover:text-fg",
    chosen: "bg-raised-hi text-fg",
  },
};

/** A value with few enough answers to show them all, the one it is on filled. DESIGN.md "Shapes". */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "control",
  fill = false,
}: Props<T>) {
  // Real radios, so the arrow keys move between them without the component saying how.
  const group = useId();
  const look = SIZES[size];
  return (
    <fieldset
      className={`flex shrink-0 items-center border-0 bg-inset inset-ring inset-ring-line-control ${look.group} ${fill ? "w-full" : ""}`}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex h-full cursor-default items-center px-2 ${fill ? "flex-1 justify-center" : ""} transition-colors duration-(--motion-quick) focus-ring-within-inset motion-reduce:transition-none ${look.option} ${
            option.value === value ? look.chosen : look.idle
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

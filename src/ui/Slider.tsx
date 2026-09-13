import type { CSSProperties } from "react";

type Props = {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
};

/** A labelled range whose thin track fills up to its value. DESIGN.md "Components". */
export function Slider({ label, min, max, step = 1, value, onChange }: Props) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="flex shrink-0 items-center gap-2 text-fg-mid text-ui">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="slider focus-ring w-slider"
        style={{ "--fill": `${fill}%` } as CSSProperties}
      />
    </label>
  );
}

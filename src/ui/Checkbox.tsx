import { Glyph } from "./Glyph";

type Props = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * A yes or no written as a sentence beside a box: a real checkbox, so Space and the label both
 * tick it, drawn as a `badge` square that fills with the plate. DESIGN.md "Components".
 */
export function Checkbox({ label, checked, onChange }: Props) {
  return (
    <label className="flex w-fit cursor-default items-center gap-2 text-fg-mid text-ui transition-colors duration-(--motion-quick) hover:text-fg has-checked:text-fg motion-reduce:transition-none">
      {/* The real box lies unseen over the drawn one, so a click on either lands on it. */}
      <span className="relative grid size-badge shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 m-0 size-full opacity-0"
        />
        <span
          aria-hidden="true"
          className="focus-ring-peer grid place-items-center rounded-badge bg-raised inset-ring inset-ring-line-control peer-checked:bg-plate peer-checked:inset-ring-0"
        >
          {checked && <Glyph name="done" className="text-glyph-small text-on-plate" />}
        </span>
      </span>
      {label}
    </label>
  );
}

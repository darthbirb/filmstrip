import { Glyph } from "./Glyph";

type Props = {
  side: "start" | "end";
  label: string;
  disabled: boolean;
  onClick: () => void;
};

/** A step along a strip, floating over its end on dark glass so it holds over any picture. */
export function StepButton({ side, label, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`focus-ring absolute top-1/2 grid h-strip-step-height w-strip-step -translate-y-1/2 place-items-center rounded-full bg-veil text-fg text-glyph inset-ring inset-ring-line-control-hi transition-colors duration-(--motion-quick) enabled:hover:text-fg-hi enabled:hover:inset-ring-line-strong disabled:text-fg-faint disabled:inset-ring-line motion-reduce:transition-none ${side === "start" ? "left-strip-inset" : "right-strip-inset"}`}
    >
      <Glyph name={side === "start" ? "chevronLeft" : "chevronRight"} />
    </button>
  );
}

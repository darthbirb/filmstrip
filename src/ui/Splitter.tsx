import { useRef } from "react";

type Props = {
  label: string;
  /** Width of the panel it sizes, in rem. */
  value: number;
  min: number;
  max: number;
  initial: number;
  /** Whether that panel sits before the splitter or after it. */
  panel: "before" | "after";
  onChange: (rem: number) => void;
  /** True while a width is being chosen, so the panel follows exactly rather than animating. */
  onSizing?: (sizing: boolean) => void;
};

// Arrow keys move a splitter by this many rem; with Shift, by the larger step.
const STEP = 1;
const LARGE_STEP = 4;

/** A draggable edge between two panels: pointer, arrow keys, Home and End, double-click to reset. */
export function Splitter({ label, value, min, max, initial, panel, onChange, onSizing }: Props) {
  const drag = useRef<{ x: number; value: number } | null>(null);
  const toward = panel === "before" ? 1 : -1;
  const set = (rem: number) => onChange(Math.min(max, Math.max(min, rem)));

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter is the ARIA window-splitter pattern, and <hr> cannot hold its hairline.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, value };
        onSizing?.(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        set(drag.current.value + ((event.clientX - drag.current.x) / rem) * toward);
      }}
      onPointerUp={() => {
        drag.current = null;
        onSizing?.(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        onSizing?.(false);
      }}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? LARGE_STEP : STEP;
        if (event.key === "ArrowLeft") set(value - step * toward);
        else if (event.key === "ArrowRight") set(value + step * toward);
        else if (event.key === "Home") set(min);
        else if (event.key === "End") set(max);
        else return;
        onSizing?.(true);
        event.preventDefault();
      }}
      onKeyUp={() => onSizing?.(false)}
      onBlur={() => onSizing?.(false)}
      className="focus-ring-inset group flex w-splitter shrink-0 cursor-col-resize touch-none items-center justify-center bg-ground"
    >
      <span className="h-grip w-grip-width rounded-full bg-line-control transition-colors duration-(--motion-quick) group-hover:bg-fg-dim group-active:bg-fg-mid motion-reduce:transition-none" />
    </div>
  );
}

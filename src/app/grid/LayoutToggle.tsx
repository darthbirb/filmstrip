import { updatePreferences, usePreferences } from "../preferences";
import { DEFAULT_LAYOUT, type LayoutMode } from "./layout";

const CHOICES: { mode: LayoutMode; label: string; title: string }[] = [
  { mode: "justified", label: "Rows", title: "Rows: every picture keeps its shape" },
  { mode: "uniform", label: "Squares", title: "Squares: every picture cropped to fill" },
];

/** Which layout the grid uses. Where this control finally lives is open. DECISIONS.md "The grid". */
export function LayoutToggle() {
  const layout = usePreferences().layout ?? DEFAULT_LAYOUT;
  return (
    <fieldset aria-label="Layout" className="flex shrink-0 items-center">
      {CHOICES.map((choice) => (
        <button
          key={choice.mode}
          type="button"
          aria-pressed={layout === choice.mode}
          title={choice.title}
          onClick={() => updatePreferences({ layout: choice.mode })}
          className={`focus-ring flex h-row items-center px-2 text-caption transition-colors duration-(--motion-quick) motion-reduce:transition-none ${layout === choice.mode ? "bg-selected text-fg" : "text-fg-muted hover:bg-hover hover:text-fg"}`}
        >
          {choice.label}
        </button>
      ))}
    </fieldset>
  );
}

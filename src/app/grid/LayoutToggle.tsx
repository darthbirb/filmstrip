import { Segmented } from "../../ui/Segmented";
import { updatePreferences, usePreferences } from "../preferences";
import { DEFAULT_LAYOUT, type LayoutMode } from "./layout";

const CHOICES: readonly { value: LayoutMode; label: string; title: string }[] = [
  { value: "justified", label: "Rows", title: "Rows: every picture keeps its shape" },
  { value: "uniform", label: "Squares", title: "Squares: every picture cropped to fill" },
];

/** Which layout the grid uses. Where this control finally lives is open. DECISIONS.md "The grid". */
export function LayoutToggle() {
  const layout = usePreferences().layout ?? DEFAULT_LAYOUT;
  return (
    <Segmented
      label="Layout"
      options={CHOICES}
      value={layout}
      onChange={(mode) => updatePreferences({ layout: mode })}
    />
  );
}

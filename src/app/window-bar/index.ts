import { CaptionStrip } from "./CaptionStrip";
import { RecedingStrip } from "./RecedingStrip";
import { TallHeader } from "./TallHeader";

// The window-bar slice's candidates, until the user picks one. DEVELOPMENT.md "Slices".
export const WINDOW_BARS = {
  strip: CaptionStrip,
  tall: TallHeader,
  receding: RecedingStrip,
};

export type WindowBarName = keyof typeof WINDOW_BARS;

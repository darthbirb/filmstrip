import type { MarkSpec } from "./Mark";

// The mark's candidates, in the current test colours, until the user picks one. DEVELOPMENT.md "Slices".
const WHITE = "#F2F2F2";
const YELLOW = "#E3D84A";
const CYAN = "#3FB8C5";
const GREEN = "#0C7C59";
const MAGENTA = "#A8478F";
const RED = "#D72638";
const BLUE = "#3F88C5";

export const MARKS = {
  five: { frames: [YELLOW, CYAN, GREEN, MAGENTA, RED], gap: 0, sprockets: "even" },
  "five-parted": { frames: [YELLOW, CYAN, GREEN, MAGENTA, RED], gap: 3, sprockets: "per-frame" },
  four: { frames: [YELLOW, CYAN, MAGENTA, RED], gap: 0, sprockets: "even" },
  "four-parted": { frames: [YELLOW, CYAN, MAGENTA, RED], gap: 4, sprockets: "per-frame" },
  seven: { frames: [WHITE, YELLOW, CYAN, GREEN, MAGENTA, RED, BLUE], gap: 0, sprockets: "even" },
} satisfies Record<string, MarkSpec>;

export type MarkName = keyof typeof MARKS;

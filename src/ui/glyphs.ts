// Segoe Fluent Icons code points, so each glyph is named once. They render in --font-glyph.
export const GLYPHS = {
  minimize: "\uE921",
  maximize: "\uE922",
  restore: "\uE923",
  close: "\uE8BB",
  dockLeft: "\uE90C",
  dockRight: "\uE90D",
  chevronRight: "\uE76C",
  chevronDown: "\uE70D",
  back: "\uE72B",
  folder: "\uE8B7",
  source: "\uEC50",
  sortingBox: "\uE7B8",
  trash: "\uE74D",
} as const;

export type Glyph = keyof typeof GLYPHS;
